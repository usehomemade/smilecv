import { createRoute, z } from "@hono/zod-openapi";
import type { UIMessage } from "ai";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "#/db";
import { cv as cvTable, cvVersion } from "#/db/schema";
import { sampleCv } from "#/lib/cv/sample";
import { cvSchema, emptyCv, normalizeCv } from "#/lib/cv/schema";
import type { CV } from "#/lib/cv/schema";
import { TEMPLATE_IDS } from "#/lib/cv/templates";
import {
  GUEST_CV_LIMIT,
  GUEST_LIMIT,
  limitKindFor,
  VERIFY_LIMIT,
} from "#/lib/guest";
import { deviceHash, spendDevice } from "#/lib/server/guest-device";
import { externalizePhoto } from "#/lib/server/photos";
import { verifyPrintToken } from "#/lib/server/print-token";
import { deleteCvAndFiles } from "#/lib/server/purge";
import { getSession, requireUser } from "#/lib/server/session";
import { m } from "#/paraglide/messages.js";
import { getLocale, isLocale } from "#/paraglide/runtime.js";
import {
  errors,
  fail,
  json,
  OkSchema,
  queryInt,
  router,
} from "#/server/api/lib";

/** Versions kept per CV; older ones are dropped. */
const KEEP = 500;

const IdParam = z.object({ id: z.string() });
const CvIdParam = z.object({ cvId: z.string() });

const CvSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    template: z.string(),
    data: cvSchema,
    updatedAt: z.string(),
  })
  .openapi("CvSummary");

const CvDetailSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    template: z.string(),
    data: cvSchema,
    /** The AI chat (UIMessage[]) as JSON text. */
    chatJson: z.string(),
    shareId: z.string().nullable(),
    shareChat: z.boolean(),
    pages: z.number(),
    updatedAt: z.string(),
  })
  .openapi("CvDetail");

const VersionSchema = z
  .object({
    id: z.string(),
    at: z.number(),
    label: z.string(),
    source: z.enum(["you", "ai", "restore"]),
    template: z.string(),
    cv: cvSchema,
  })
  .openapi("CvVersion");

type StoredVersion = z.infer<typeof VersionSchema>;

const NewIdSchema = z.object({ id: z.string() }).openapi("NewId");

const assertCanCreate = async (
  user: {
    id: string;
    isAnonymous?: boolean | null;
    emailVerified?: boolean | null;
  },
  cookie: string | null
) => {
  const kind = limitKindFor(user);
  if (!kind) {
    return;
  }
  const code = kind === "guest" ? GUEST_LIMIT : VERIFY_LIMIT;
  const [row] = await db
    .select({ n: count() })
    .from(cvTable)
    .where(eq(cvTable.userId, user.id));
  if ((row?.n ?? 0) >= GUEST_CV_LIMIT) {
    fail(403, code);
  }
  if (kind !== "guest") {
    return;
  }
  // The same browser as an earlier guest shares that guest's allowance.
  if (!(await spendDevice(deviceHash(cookie), "cvs", GUEST_CV_LIMIT))) {
    fail(403, GUEST_LIMIT);
  }
};

const withAccount = (
  cv: CV,
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    isAnonymous?: boolean | null;
  }
): CV => {
  if (user.isAnonymous) {
    return cv;
  }
  const local = user.email?.split("@")[0] ?? "";
  const name = user.name && user.name !== local ? user.name : "";
  return {
    ...cv,
    basics: {
      ...cv.basics,
      name: cv.basics.name || name,
      email: cv.basics.email || (user.email ?? ""),
      photo: cv.basics.photo || (user.image ?? ""),
    },
  };
};

const ownCv = async (headers: Headers, cvId: string) => {
  const user = await requireUser(headers);
  const [row] = await db
    .select({ id: cvTable.id })
    .from(cvTable)
    .where(and(eq(cvTable.id, cvId), eq(cvTable.userId, user.id)));
  if (!row) {
    fail(404, m.err_cv_not_found());
  }
};

const withPhotos = (
  rows: (typeof cvVersion.$inferSelect)[]
): Promise<StoredVersion[]> =>
  Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      at: r.createdAt.getTime(),
      label: r.label,
      source: r.source as StoredVersion["source"],
      template: r.template,
      cv: await externalizePhoto(normalizeCv(r.data)),
    }))
  );

const publicMessage = (msg: UIMessage): UIMessage => ({
  ...msg,
  parts: msg.parts.filter((p) => p.type !== "file"),
});

const cvRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/cvs",
      tags: ["CVs"],
      summary: "The viewer's CVs, newest first",
      responses: {
        200: json(z.array(CvSummarySchema), "CVs (empty when signed out)"),
        ...errors,
      },
    }),
    async (c) => {
      const session = await getSession(c.req.raw.headers);
      if (!session) {
        return c.json([], 200);
      }
      const rows = await db
        .select()
        .from(cvTable)
        .where(eq(cvTable.userId, session.user.id))
        .orderBy(desc(cvTable.updatedAt));
      return c.json(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          template: r.template,
          data: normalizeCv(r.data),
          updatedAt: r.updatedAt.toISOString(),
        })),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cvs",
      tags: ["CVs"],
      summary: "Create a CV (blank, from a template or the sample)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                template: z.enum(TEMPLATE_IDS).optional(),
                sample: z.boolean().optional(),
                title: z.string().optional(),
                /** The creator's UI locale; headings and title of a new CV use it. */
                locale: z.string().optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(NewIdSchema, "The new CV's id"), ...errors },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const user = await requireUser(c.req.raw.headers);
      await assertCanCreate(user, c.req.header("cookie") ?? null);
      const locale =
        data.locale && isLocale(data.locale) ? data.locale : getLocale();
      const id = nanoid(12);
      await db.insert(cvTable).values({
        id,
        userId: user.id,
        title: data.title ?? m.cv_untitled({}, { locale }),
        template: data.template ?? "classic",
        data: data.sample
          ? sampleCv(locale)
          : withAccount(emptyCv(locale), user),
      });
      return c.json({ id }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cvs/{id}",
      tags: ["CVs"],
      summary: "One of the viewer's CVs, with its chat",
      request: { params: IdParam },
      responses: {
        200: json(CvDetailSchema.nullable(), "Null when not found"),
        ...errors,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = await requireUser(c.req.raw.headers);
      const [row] = await db
        .select()
        .from(cvTable)
        .where(and(eq(cvTable.id, id), eq(cvTable.userId, user.id)));
      if (!row) {
        return c.json(null, 200);
      }
      return c.json(
        {
          id: row.id,
          title: row.title,
          template: row.template,
          data: normalizeCv(row.data),
          chatJson: JSON.stringify(row.chat ?? []),
          shareId: row.shareId,
          shareChat: row.shareChat,
          pages: row.pages,
          updatedAt: row.updatedAt.toISOString(),
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/cvs/{id}",
      tags: ["CVs"],
      summary: "Save changes to a CV",
      request: {
        params: IdParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                title: z.string().max(120).optional(),
                template: z.enum(TEMPLATE_IDS).optional(),
                data: cvSchema.optional(),
                pages: z.number().int().min(1).max(50).optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Saved"), ...errors },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const user = await requireUser(c.req.raw.headers);
      if (patch.data) {
        patch.data = await externalizePhoto(patch.data);
      }
      await db
        .update(cvTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(cvTable.id, id), eq(cvTable.userId, user.id)));
      return c.json({ ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/cvs/{id}",
      tags: ["CVs"],
      summary: "Delete a CV and its files",
      request: { params: IdParam },
      responses: { 200: json(OkSchema, "Deleted"), ...errors },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = await requireUser(c.req.raw.headers);
      await deleteCvAndFiles(id, user.id);
      return c.json({ ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cvs/{id}/duplicate",
      tags: ["CVs"],
      summary: "Copy a CV",
      request: { params: IdParam },
      responses: { 200: json(NewIdSchema, "The copy's id"), ...errors },
    }),
    async (c) => {
      const { id: sourceId } = c.req.valid("param");
      const user = await requireUser(c.req.raw.headers);
      const [row] = await db
        .select()
        .from(cvTable)
        .where(and(eq(cvTable.id, sourceId), eq(cvTable.userId, user.id)));
      if (!row) {
        return fail(404, m.err_cv_not_found());
      }
      await assertCanCreate(user, c.req.header("cookie") ?? null);
      const id = nanoid(12);
      await db.insert(cvTable).values({
        id,
        userId: user.id,
        title: m.cv_copy_title({ title: row.title }),
        template: row.template,
        data: row.data,
      });
      return c.json({ id }, 200);
    }
  );

const shareRoutes = router()
  .openapi(
    createRoute({
      method: "put",
      path: "/cvs/{id}/sharing",
      tags: ["Sharing"],
      summary:
        "Turn the public link on or off, and choose whether it shows the chat",
      description:
        "Switching off clears the link id, so an old link stops working.",
      request: {
        params: IdParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                enabled: z.boolean().optional(),
                chat: z.boolean().optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z
            .object({ shareId: z.string().nullable(), shareChat: z.boolean() })
            .openapi("Sharing"),
          "Sharing state"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const user = await requireUser(c.req.raw.headers);
      const where = and(eq(cvTable.id, id), eq(cvTable.userId, user.id));
      const [row] = await db
        .select({ shareId: cvTable.shareId, shareChat: cvTable.shareChat })
        .from(cvTable)
        .where(where);
      if (!row) {
        return fail(404, m.err_cv_not_found());
      }
      let { shareId } = row;
      if (data.enabled === true && !shareId) {
        shareId = nanoid(12);
      }
      if (data.enabled === false) {
        shareId = null;
      }
      const shareChat = data.chat ?? row.shareChat;
      await db.update(cvTable).set({ shareId, shareChat }).where(where);
      return c.json({ shareId, shareChat }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/cvs/{id}/chat",
      tags: ["CVs"],
      summary: "Empty the AI chat of a CV",
      request: { params: IdParam },
      responses: { 200: json(OkSchema, "Cleared"), ...errors },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = await requireUser(c.req.raw.headers);
      await db
        .update(cvTable)
        .set({ chat: [] })
        .where(and(eq(cvTable.id, id), eq(cvTable.userId, user.id)));
      return c.json({ ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/shared/{shareId}",
      tags: ["Sharing"],
      summary: "A shared CV as anyone with the link sees it",
      request: {
        params: z.object({ shareId: z.string().min(8).max(32) }),
      },
      responses: {
        200: json(
          z
            .object({
              id: z.string(),
              title: z.string(),
              template: z.string(),
              pages: z.number(),
              data: cvSchema,
              chatJson: z.string(),
              updatedAt: z.string(),
            })
            .openapi("SharedCv")
            .nullable(),
          "Null when the link is off or unknown"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { shareId } = c.req.valid("param");
      const [row] = await db
        .select()
        .from(cvTable)
        .where(eq(cvTable.shareId, shareId));
      if (!row) {
        return c.json(null, 200);
      }
      const chat = row.shareChat ? (row.chat as UIMessage[]) : [];
      return c.json(
        {
          id: row.id,
          title: row.title,
          template: row.template,
          pages: row.pages,
          data: normalizeCv(row.data),
          chatJson: JSON.stringify(chat.map(publicMessage)),
          updatedAt: row.updatedAt.toISOString(),
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/print/{id}",
      tags: ["Sharing"],
      summary: "A CV for the PDF/PNG renderer, with a short-lived print token",
      request: { params: IdParam, query: z.object({ token: z.string() }) },
      responses: {
        200: json(
          z
            .object({ template: z.string(), data: cvSchema })
            .openapi("PrintCv")
            .nullable(),
          "Null when the token is wrong or expired"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { token } = c.req.valid("query");
      if (!verifyPrintToken(id, token)) {
        return c.json(null, 200);
      }
      const [row] = await db.select().from(cvTable).where(eq(cvTable.id, id));
      if (!row) {
        return c.json(null, 200);
      }
      return c.json(
        { template: row.template, data: normalizeCv(row.data) },
        200
      );
    }
  );

const versionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/cvs/{cvId}/versions",
      tags: ["History"],
      summary: "Versions of a CV, oldest first; `before` pages further back",
      request: {
        params: CvIdParam,
        query: z.object({
          before: z
            .string()
            .regex(/^\d+(?:\.\d+)?$/u)
            .transform(Number)
            .optional(),
          limit: queryInt(1, 100).optional(),
        }),
      },
      responses: {
        200: json(
          z
            .object({ versions: z.array(VersionSchema), more: z.boolean() })
            .openapi("CvVersions"),
          "A page of versions"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { cvId } = c.req.valid("param");
      const { before, limit = 40 } = c.req.valid("query");
      await ownCv(c.req.raw.headers, cvId);
      const rows = await db
        .select()
        .from(cvVersion)
        .where(
          and(
            eq(cvVersion.cvId, cvId),
            before ? lt(cvVersion.createdAt, new Date(before)) : undefined
          )
        )
        .orderBy(desc(cvVersion.createdAt))
        .limit(limit + 1);
      const more = rows.length > limit;
      const versions = await withPhotos(rows.slice(0, limit).toReversed());
      return c.json({ versions, more }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/cvs/{cvId}/versions/{id}",
      tags: ["History"],
      summary: "Store a version",
      description:
        "The newest version keeps absorbing typing, so the same id is saved again with newer content (upsert).",
      request: {
        params: z.object({ cvId: z.string(), id: z.string().min(1).max(64) }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                at: z.number(),
                label: z.string().max(200),
                source: z.enum(["you", "ai", "restore"]),
                template: z.enum(TEMPLATE_IDS),
                data: cvSchema,
              }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Stored"), ...errors },
    }),
    async (c) => {
      const { cvId, id } = c.req.valid("param");
      const data = c.req.valid("json");
      await ownCv(c.req.raw.headers, cvId);
      const stored = await externalizePhoto(data.data);
      const now = new Date();
      await db
        .insert(cvVersion)
        .values({
          id,
          cvId,
          label: data.label,
          source: data.source,
          template: data.template,
          data: stored,
          createdAt: new Date(data.at),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: cvVersion.id,
          set: { data: stored, template: data.template, updatedAt: now },
          setWhere: eq(cvVersion.cvId, cvId),
        });
      // Keep the table bounded (checked now and then, not on every keystroke).
      if (Math.random() > 0.1) {
        return c.json({ ok: true }, 200);
      }
      await db.execute(sql`
        delete from ${cvVersion}
        where ${cvVersion.cvId} = ${cvId}
          and ${cvVersion.id} not in (
            select id from ${cvVersion}
            where ${cvVersion.cvId} = ${cvId}
            order by ${cvVersion.createdAt} desc
            limit ${KEEP}
          )
      `);
      return c.json({ ok: true }, 200);
    }
  );

export const cvs = router()
  .route("/", cvRoutes)
  .route("/", shareRoutes)
  .route("/", versionRoutes);
