import { createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "#/db";
import { cvFile, cv as cvTable } from "#/db/schema";
import { auth } from "#/lib/auth";
import { fileUrl, MAX_FILE_BYTES } from "#/lib/server/files";
import { MAX_PHOTO_BYTES, PHOTO_HASH, storePhoto } from "#/lib/server/photos";
import {
  avatarKey,
  fileKey,
  getObject,
  photoKey,
  putObject,
} from "#/lib/server/storage";
import { binary, json, router } from "#/server/api/lib";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const UrlSchema = z.object({ url: z.string() }).openapi("StoredUrl");

/** A plain-text answer (documented without a schema, sent as a Response). */
const text = (description: string) => ({ description });

const isBanned = (user: object) =>
  "banned" in user && (user as { banned?: boolean | null }).banned === true;

/** Public, content-addressed images (the URL changes with the content). */
const immutable = (body: Uint8Array<ArrayBuffer>, contentType: string) =>
  new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });

export const files = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/files/{id}",
      tags: ["Files"],
      summary: "A chat file, for its owner only",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: binary("application/octet-stream", "The file"),
        401: { description: "Not signed in" },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { id } = c.req.valid("param");
      const [row] = await db
        .select({
          id: cvFile.id,
          name: cvFile.name,
          mediaType: cvFile.mediaType,
        })
        .from(cvFile)
        .where(and(eq(cvFile.id, id), eq(cvFile.userId, session.user.id)));
      const object = row ? await getObject(fileKey(row.id)) : null;
      if (!(row && object)) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(object.body, {
        headers: {
          "content-type": row.mediaType,
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/upload",
      tags: ["Files"],
      summary: "Store a file attached in the chat; answers with its URL",
      request: {
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z
                  .instanceof(File)
                  .refine((f) => f.size <= MAX_FILE_BYTES)
                  .openapi({ type: "string", format: "binary" }),
                cvId: z.string(),
              }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: json(UrlSchema, "Where the file is served"),
        400: text("Bad file"),
        401: text("Not signed in"),
        403: text("Banned"),
        404: text("CV not found"),
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (isBanned(session.user)) {
        return new Response("Forbidden", { status: 403 });
      }
      const { file, cvId } = c.req.valid("form");
      const [row] = await db
        .select({ id: cvTable.id })
        .from(cvTable)
        .where(and(eq(cvTable.id, cvId), eq(cvTable.userId, session.user.id)));
      if (!row) {
        return new Response("Not found", { status: 404 });
      }
      const id = nanoid(16);
      const mediaType = file.type || "application/octet-stream";
      await putObject(fileKey(id), await file.arrayBuffer(), mediaType);
      await db.insert(cvFile).values({
        id,
        cvId,
        userId: session.user.id,
        name: file.name.slice(0, 200) || "file",
        mediaType,
        size: file.size,
      });
      return c.json({ url: fileUrl(id, file.size) }, 200);
    },
    (result) => {
      if (!result.success) {
        return new Response("Bad file", { status: 400 });
      }
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/photo",
      tags: ["Files"],
      summary: "Store a CV photo (already downscaled in the browser)",
      request: {
        body: {
          content: {
            "image/jpeg": { schema: z.string().openapi({ format: "binary" }) },
            "image/png": { schema: z.string().openapi({ format: "binary" }) },
            "image/webp": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
      },
      responses: {
        200: json(UrlSchema, "Where the photo is served"),
        400: text("Bad photo"),
        401: text("Not signed in"),
        403: text("Banned"),
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (isBanned(session.user)) {
        return new Response("Forbidden", { status: 403 });
      }
      const type = c.req.header("content-type") ?? "";
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (!IMAGE_TYPES.has(type) || bytes.byteLength > MAX_PHOTO_BYTES) {
        return new Response("Bad photo", { status: 400 });
      }
      return c.json({ url: await storePhoto(bytes, type) }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/photos/{hash}",
      tags: ["Files"],
      summary: "A CV photo; public (shared CVs show it), the URL is its hash",
      request: { params: z.object({ hash: z.string() }) },
      responses: {
        200: binary("image/*", "The photo"),
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const { hash } = c.req.valid("param");
      const object = PHOTO_HASH.test(hash)
        ? await getObject(photoKey(hash))
        : null;
      if (!object) {
        return new Response("Not found", { status: 404 });
      }
      return immutable(object.body, object.contentType);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/avatar/{userId}",
      tags: ["Files"],
      summary: "A user's uploaded profile picture",
      description: "Public; the URL changes on every upload.",
      request: { params: z.object({ userId: z.string() }) },
      responses: {
        200: binary("image/*", "The picture"),
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const object = await getObject(avatarKey(c.req.valid("param").userId));
      if (!object) {
        return new Response("Not found", { status: 404 });
      }
      return immutable(object.body, object.contentType);
    }
  );
