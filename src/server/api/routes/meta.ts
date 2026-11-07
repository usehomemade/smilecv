import { createRoute, z } from "@hono/zod-openapi";
import { count, eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";

import { db } from "#/db";
import { cv, user as userTable } from "#/db/schema";
import { DOCK_COOKIE, parseDock } from "#/lib/dock-prefs";
import { REPO } from "#/lib/github";
import { GUEST_AI_LIMIT, limitKindFor } from "#/lib/guest";
import { LAST_LOGIN_COOKIE } from "#/lib/last-login";
import { isAdminUser } from "#/lib/server/admin-guard";
import { serverEnv as env } from "#/lib/server/env";
import { deviceHash, deviceUsed } from "#/lib/server/guest-device";
import { getSession } from "#/lib/server/session";
import { errors, json, router } from "#/server/api/lib";

const STARS_TTL = 10 * 60_000;
const COUNT_TTL = 60_000;
const DEFAULT_SCRIPT = "https://analytics.wust.co/script.js";
const FILE_NAME = /[^/]*$/u;

let starsCache: { stars: number | null; at: number } | null = null;
let countCache: { cvs: number; at: number } | null = null;

/** Star count, cached for 10 minutes to stay well under GitHub's anonymous rate limit. */
const stars = async () => {
  if (starsCache && Date.now() - starsCache.at < STARS_TTL) {
    return starsCache.stars;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "smilecv.com",
      },
    });
    const value = res.ok
      ? ((await res.json()) as { stargazers_count: number }).stargazers_count
      : (starsCache?.stars ?? null);
    starsCache = { stars: value, at: Date.now() };
    return value;
  } catch {
    return starsCache?.stars ?? null;
  }
};

/** How many CVs exist, counted from the database and cached for a minute. */
const cvCount = async () => {
  if (countCache && Date.now() - countCache.at < COUNT_TTL) {
    return countCache.cvs;
  }
  try {
    const [row] = await db.select({ n: count() }).from(cv);
    countCache = { cvs: row?.n ?? 0, at: Date.now() };
    return countCache.cvs;
  } catch {
    return countCache?.cvs ?? null;
  }
};

export const AnalyticsConfigSchema = z
  .object({
    websiteId: z.string(),
    scriptUrl: z.string(),
    recorderUrl: z.string(),
    domains: z.string().nullable(),
    /** Dev traffic is tagged so it can be filtered out in Umami. */
    tag: z.string().nullable(),
  })
  .openapi("AnalyticsConfig");

/**
 * Umami settings for the page: UMAMI_WEBSITE_ID (off when unset) and
 * UMAMI_SCRIPT_URL; the replay recorder sits next to the tracker script.
 */
const analyticsConfig = async () => {
  const websiteId = await env("UMAMI_WEBSITE_ID");
  if (!websiteId) {
    return null;
  }
  const scriptUrl = (await env("UMAMI_SCRIPT_URL")) || DEFAULT_SCRIPT;
  let domains: string | null = null;
  try {
    domains = new URL(process.env.BETTER_AUTH_URL ?? "").hostname || null;
  } catch {
    domains = null;
  }
  return {
    websiteId,
    scriptUrl,
    recorderUrl: scriptUrl.replace(FILE_NAME, "recorder.js"),
    domains,
    tag: import.meta.env.DEV ? "dev" : null,
  };
};

const ViewerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    isAnonymous: z.boolean(),
    emailVerified: z.boolean(),
    /** Why the free limits apply: guest, unconfirmed email, or none. */
    limitKind: z.enum(["guest", "verify"]).nullable(),
    /** Shows the Admin entry in the account menu (checked again on /admin). */
    isAdmin: z.boolean(),
    /** AI messages a guest has left; null for signed-up users. */
    guestAiLeft: z.number().nullable(),
  })
  .openapi("Viewer");

const viewer = async (headers: Headers) => {
  const session = await getSession(headers);
  if (!session) {
    return null;
  }
  const u = session.user as typeof session.user & {
    isAnonymous?: boolean | null;
  };
  let guestAiLeft: number | null = null;
  const limitKind = limitKindFor(u);
  if (limitKind) {
    const [row] = await db
      .select({ used: userTable.aiMessages })
      .from(userTable)
      .where(eq(userTable.id, u.id));
    const device =
      limitKind === "guest"
        ? await deviceUsed(deviceHash(headers.get("cookie")), "aiMessages")
        : 0;
    guestAiLeft = Math.max(
      0,
      GUEST_AI_LIMIT - Math.max(row?.used ?? 0, device)
    );
  }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    isAnonymous: Boolean(u.isAnonymous),
    emailVerified: Boolean(u.emailVerified),
    limitKind,
    isAdmin: await isAdminUser(u),
    guestAiLeft,
  };
};

const DockPrefsSchema = z
  .object({
    minimized: z.boolean(),
    side: z.enum(["left", "right"]),
    width: z.number(),
  })
  .openapi("DockPrefs");

export const meta = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/github/stars",
      tags: ["Site"],
      summary: "GitHub stars of the repository",
      responses: {
        200: json(z.number().nullable(), "Star count, or null if unknown"),
        ...errors,
      },
    }),
    async (c) => c.json(await stars(), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/stats/cvs",
      tags: ["Site"],
      summary: "How many CVs exist",
      responses: {
        200: json(z.number().nullable(), "CV count, or null if unknown"),
        ...errors,
      },
    }),
    async (c) => c.json(await cvCount(), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/analytics-config",
      tags: ["Site"],
      summary: "Umami settings for the page",
      responses: {
        200: json(
          AnalyticsConfigSchema.nullable(),
          "Null when analytics are off"
        ),
        ...errors,
      },
    }),
    async (c) => c.json(await analyticsConfig(), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/auth-options",
      tags: ["Session"],
      summary: "Which sign-in methods are set up",
      responses: {
        200: json(
          z.object({ googleEnabled: z.boolean() }).openapi("AuthOptions"),
          "Sign-in options"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { authConfig } = await import("#/lib/auth");
      return c.json(authConfig, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/last-login",
      tags: ["Session"],
      summary: "The sign-in method used last time",
      description:
        "Read from Better Auth's lastLoginMethod cookie so the badge is in the first render.",
      responses: {
        200: json(z.enum(["google", "email"]).nullable(), "Method or null"),
        ...errors,
      },
    }),
    (c) => {
      const value = getCookie(c, LAST_LOGIN_COOKIE);
      return c.json(
        value === "google" || value === "email" ? value : null,
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/dock-prefs",
      tags: ["Session"],
      summary: "Saved side and width of the editor's chat card",
      responses: { 200: json(DockPrefsSchema, "Dock preferences"), ...errors },
    }),
    (c) => {
      const cookie = c.req.header("cookie") ?? "";
      const match = cookie.match(
        new RegExp(`(?:^|; )${DOCK_COOKIE}=(?<value>[^;]*)`, "u")
      );
      return c.json(parseDock(match?.groups?.value), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/viewer",
      tags: ["Session"],
      summary: "The signed-in user (or guest), with their free limits",
      responses: {
        200: json(ViewerSchema.nullable(), "Null when signed out"),
        ...errors,
      },
    }),
    async (c) => c.json(await viewer(c.req.raw.headers), 200)
  );
