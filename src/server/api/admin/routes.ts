import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { db } from "#/db";
import { cvFile } from "#/db/schema";
import { cvSchema } from "#/lib/cv/schema";
import { adminFromHeaders } from "#/lib/server/admin-guard";
import { fileKey, getObject } from "#/lib/server/storage";
import {
  banAdminUser,
  deleteAdminUser,
  getAdminAccess,
  getAdminCv,
  getAdminOverview,
  getAdminUsage,
  getAdminUser,
  listAdminFiles,
  listAdminUsage,
  listAdminUsers,
  sendAdminVerification,
  setAdminEmailVerified,
  unbanAdminUser,
} from "#/server/api/admin/data";
import {
  binary,
  errors,
  json,
  OkSchema,
  QueryFlag,
  queryInt,
  router,
} from "#/server/api/lib";

const IdParam = z.object({ id: z.string().max(100) });
const Page = queryInt(0, 10_000).optional();
const Search = z.string().max(200).optional();

const OverviewSchema = z
  .object({
    users: z.object({
      total: z.number(),
      guests: z.number(),
      registered: z.number(),
      new7: z.number(),
      newRegistered7: z.number(),
      banned: z.number(),
      active7: z.number(),
    }),
    cvs: z.object({ total: z.number(), new7: z.number(), shared: z.number() }),
    files: z.object({ total: z.number(), bytes: z.number() }),
    ai: z.object({
      chats: z.number(),
      chats7: z.number(),
      errors7: z.number(),
      costToday: z.number(),
      cost7: z.number(),
      cost30: z.number(),
      costAll: z.number(),
      searches30: z.number(),
    }),
    days: z.array(
      z.object({
        day: z.string(),
        chat: z.number(),
        translate: z.number(),
        faq: z.number(),
        requests: z.number(),
        guests: z.number(),
        registered: z.number(),
      })
    ),
    topSpenders: z.array(
      z.object({
        userId: z.string().nullable(),
        name: z.string(),
        email: z.string(),
        isAnonymous: z.boolean(),
        cost: z.number(),
        requests: z.number(),
      })
    ),
  })
  .openapi("AdminOverview");

const UserRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  isAnonymous: z.boolean(),
  emailVerified: z.boolean(),
  banned: z.boolean(),
  createdAt: z.string(),
  lastActive: z.string().nullable(),
  cvCount: z.number(),
  aiCount: z.number(),
  aiCost: z.number(),
});

const UsersSchema = z
  .object({
    total: z.number(),
    hasMore: z.boolean(),
    page: z.number(),
    rows: z.array(UserRowSchema),
  })
  .openapi("AdminUsers");

const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  size: z.number(),
  createdAt: z.string(),
});

const UserDetailSchema = z
  .object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
      isAnonymous: z.boolean(),
      emailVerified: z.boolean(),
      banned: z.boolean(),
      banReason: z.string().nullable(),
      banExpires: z.string().nullable(),
      guestAiMessages: z.number(),
      createdAt: z.string(),
      lastSeen: z.string().nullable(),
      userAgent: z.string().nullable(),
      providers: z.array(z.string()),
      isAdmin: z.boolean(),
    }),
    cvs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        template: z.string(),
        data: cvSchema,
        shareId: z.string().nullable(),
        pages: z.number(),
        messages: z.number(),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    ),
    files: z.array(FileSchema.extend({ cvId: z.string() })),
    usage: z.object({
      requests: z.number(),
      chats: z.number(),
      cost: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      errors: z.number(),
    }),
  })
  .openapi("AdminUser");

const AdminCvSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    owner: z.object({
      name: z.string(),
      email: z.string(),
      isAnonymous: z.boolean(),
    }),
    title: z.string(),
    template: z.string(),
    data: cvSchema,
    chatJson: z.string(),
    shareId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    files: z.array(FileSchema),
    usage: z.object({ requests: z.number(), cost: z.number() }),
  })
  .openapi("AdminCv");

const FilesSchema = z
  .object({
    total: z.number(),
    bytes: z.number(),
    hasMore: z.boolean(),
    page: z.number(),
    rows: z.array(
      FileSchema.extend({
        cvId: z.string(),
        cvTitle: z.string(),
        userId: z.string(),
        userEmail: z.string(),
        userName: z.string(),
        isAnonymous: z.boolean(),
      })
    ),
  })
  .openapi("AdminFiles");

const UsageFields = {
  id: z.string(),
  kind: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  reasoningTokens: z.number(),
  webSearches: z.number(),
  steps: z.number(),
  tools: z.array(z.string()),
  costUsd: z.number(),
  durationMs: z.number(),
  error: z.string().nullable(),
  createdAt: z.string(),
  userId: z.string().nullable(),
  userEmail: z.string().nullable(),
  isAnonymous: z.boolean(),
  cvId: z.string().nullable(),
  cvTitle: z.string().nullable(),
};

const UsageListSchema = z
  .object({
    total: z.number(),
    cost: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    webSearches: z.number(),
    hasMore: z.boolean(),
    page: z.number(),
    rows: z.array(z.object(UsageFields)),
  })
  .openapi("AdminUsageList");

const UsageDetailSchema = z
  .object({
    ...UsageFields,
    userName: z.string().nullable(),
    /** JSON text: the detail is free-form and only read by the admin UI. */
    detailJson: z.string().nullable(),
  })
  .openapi("AdminUsage");

const readRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/access",
      tags: ["Admin"],
      summary: "Whether the visitor may open /admin",
      responses: {
        200: json(
          z.object({ email: z.string() }).openapi("AdminAccess").nullable(),
          "The admin, or null"
        ),
        ...errors,
      },
    }),
    async (c) => c.json(await getAdminAccess(c.req.raw.headers), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/overview",
      tags: ["Admin"],
      summary: "People, CVs, AI spend, and 30 days of cost",
      responses: { 200: json(OverviewSchema, "Overview"), ...errors },
    }),
    async (c) => c.json(await getAdminOverview(c.req.raw.headers), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/users",
      tags: ["Admin"],
      summary: "Users with their CV count, AI use, spend and last activity",
      request: {
        query: z.object({
          q: Search,
          filter: z.enum(["all", "registered", "guests", "banned"]).optional(),
          page: Page,
        }),
      },
      responses: { 200: json(UsersSchema, "A page of users"), ...errors },
    }),
    async (c) =>
      c.json(await listAdminUsers(c.req.raw.headers, c.req.valid("query")), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/users/{id}",
      tags: ["Admin"],
      summary: "One user: profile, sign-in methods, CVs, files, AI spend",
      request: { params: IdParam },
      responses: {
        200: json(UserDetailSchema.nullable(), "Null when not found"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(await getAdminUser(c.req.raw.headers, c.req.valid("param")), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cvs/{id}",
      tags: ["Admin"],
      summary: "A CV with its chat, read-only, for any owner",
      request: { params: IdParam },
      responses: {
        200: json(AdminCvSchema.nullable(), "Null when not found"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(await getAdminCv(c.req.raw.headers, c.req.valid("param")), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files",
      tags: ["Admin"],
      summary: "Every file attached in a chat, newest first",
      request: { query: z.object({ q: Search, page: Page }) },
      responses: { 200: json(FilesSchema, "A page of files"), ...errors },
    }),
    async (c) =>
      c.json(await listAdminFiles(c.req.raw.headers, c.req.valid("query")), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/usage",
      tags: ["Admin"],
      summary: "AI requests, newest first, with tokens and cost",
      request: {
        query: z.object({
          kind: z.enum(["all", "chat", "translate", "faq"]).optional(),
          userId: z.string().max(100).optional(),
          errors: QueryFlag.optional(),
          page: Page,
        }),
      },
      responses: {
        200: json(UsageListSchema, "A page of AI requests"),
        ...errors,
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      return c.json(
        await listAdminUsage(c.req.raw.headers, {
          ...query,
          errors: query.errors === "true",
        }),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/usage/{id}",
      tags: ["Admin"],
      summary: "One AI request with everything recorded about it",
      request: { params: IdParam },
      responses: {
        200: json(UsageDetailSchema.nullable(), "Null when not found"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(await getAdminUsage(c.req.raw.headers, c.req.valid("param")), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files/{id}",
      tags: ["Admin"],
      summary: "Download any chat file",
      description:
        "Inline (`?inline`) only for raster images; anything else downloads, so an uploaded HTML file can never run on this origin.",
      request: {
        params: z.object({ id: z.string() }),
        query: z.object({ inline: z.string().optional() }),
      },
      responses: {
        200: binary("application/octet-stream", "The file"),
        404: { description: "Not found, or not an admin" },
      },
    }),
    async (c) => {
      if (!(await adminFromHeaders(c.req.raw.headers))) {
        return new Response("Not found", { status: 404 });
      }
      const { id } = c.req.valid("param");
      const [row] = await db
        .select({
          id: cvFile.id,
          name: cvFile.name,
          mediaType: cvFile.mediaType,
        })
        .from(cvFile)
        .where(eq(cvFile.id, id));
      const object = row ? await getObject(fileKey(row.id)) : null;
      if (!(row && object)) {
        return new Response("Not found", { status: 404 });
      }
      const safeInline =
        c.req.valid("query").inline !== undefined &&
        row.mediaType.startsWith("image/") &&
        row.mediaType !== "image/svg+xml";
      return new Response(object.body, {
        headers: {
          "content-type": row.mediaType,
          "content-disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        },
      });
    }
  );

const writeRoutes = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/users/{id}/ban",
      tags: ["Admin"],
      summary: "Ban a user: no new sessions, current ones signed out",
      request: {
        params: IdParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                reason: z.string().max(500).optional(),
                /** Ban length in days; none bans until lifted. */
                days: z.number().int().min(1).max(3650).optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Banned"), ...errors },
    }),
    async (c) =>
      c.json(
        await banAdminUser(c.req.raw.headers, {
          ...c.req.valid("param"),
          ...c.req.valid("json"),
        }),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/users/{id}/unban",
      tags: ["Admin"],
      summary: "Lift a ban",
      request: { params: IdParam },
      responses: { 200: json(OkSchema, "Unbanned"), ...errors },
    }),
    async (c) =>
      c.json(await unbanAdminUser(c.req.raw.headers, c.req.valid("param")), 200)
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/users/{id}",
      tags: ["Admin"],
      summary: "Delete a user and everything they made; AI usage stays",
      request: { params: IdParam },
      responses: { 200: json(OkSchema, "Deleted"), ...errors },
    }),
    async (c) =>
      c.json(
        await deleteAdminUser(c.req.raw.headers, c.req.valid("param")),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/users/{id}/verification-email",
      tags: ["Admin"],
      summary: "Email the user a confirmation link (in the admin's language)",
      request: { params: IdParam },
      responses: { 200: json(OkSchema, "Sent"), ...errors },
    }),
    async (c) =>
      c.json(
        await sendAdminVerification(c.req.raw.headers, c.req.valid("param")),
        200
      )
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/users/{id}/email-verified",
      tags: ["Admin"],
      summary: "Mark the email as confirmed or not",
      description:
        "Unconfirmed accounts get the guest limits again (src/lib/guest.ts limitKindFor).",
      request: {
        params: IdParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ verified: z.boolean() }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Saved"), ...errors },
    }),
    async (c) =>
      c.json(
        await setAdminEmailVerified(c.req.raw.headers, {
          ...c.req.valid("param"),
          ...c.req.valid("json"),
        }),
        200
      )
  );

export const admin = router().route("/", readRoutes).route("/", writeRoutes);
