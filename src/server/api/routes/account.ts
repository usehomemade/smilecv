import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { db } from "#/db";
import {
  account as accountTable,
  userAvatar,
  user as userTable,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import { deleteUserAndFiles } from "#/lib/server/purge";
import { getSession } from "#/lib/server/session";
import { avatarKey, deleteObjects, putObject } from "#/lib/server/storage";
import { m } from "#/paraglide/messages.js";
import { errors, fail, json, OkSchema, router } from "#/server/api/lib";

const AVATAR_PATH = "/api/avatar/";
/** A 256×256 WebP (or PNG where the browser can't encode WebP), as a data URL. */
const AVATAR_DATA_URL =
  /^data:(?<mediaType>image\/(?:webp|png|jpeg));base64,(?<base64>[A-Za-z0-9+/=]+)$/u;
const MAX_AVATAR_BYTES = 300 * 1024;

type Member = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"] & {
  isAnonymous?: boolean | null;
};

const memberOf = async (headers: Headers): Promise<Member | null> => {
  const session = await getSession(headers);
  const u: Member | undefined = session?.user;
  return u && !u.isAnonymous ? u : null;
};

const requireMember = async (headers: Headers) =>
  (await memberOf(headers)) ?? fail(401, m.err_not_signed_in());

const AccountSchema = z
  .object({
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    /** An uploaded picture is set (so it can be removed). */
    uploaded: z.boolean(),
    providerImage: z.string().nullable(),
    hasPassword: z.boolean(),
    canChangeEmail: z.boolean(),
    providers: z.array(z.string()),
  })
  .openapi("Account");

const ImageSchema = z
  .object({ image: z.string().nullable() })
  .openapi("ProfileImage");

export const accountRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/account",
      tags: ["Account"],
      summary: "What the settings page shows: profile, sign-in methods",
      responses: {
        200: json(AccountSchema.nullable(), "Null for guests and signed out"),
        ...errors,
      },
    }),
    async (c) => {
      const u = await memberOf(c.req.raw.headers);
      if (!u) {
        return c.json(null, 200);
      }
      const accounts = await db
        .select({ providerId: accountTable.providerId })
        .from(accountTable)
        .where(eq(accountTable.userId, u.id));
      const providers = accounts.map((a) => a.providerId);
      const [avatar] = await db
        .select({ providerImage: userAvatar.providerImage })
        .from(userAvatar)
        .where(eq(userAvatar.userId, u.id));
      return c.json(
        {
          name: u.name,
          email: u.email,
          emailVerified: Boolean(u.emailVerified),
          image: u.image ?? null,
          uploaded: Boolean(avatar),
          providerImage: avatar?.providerImage ?? null,
          hasPassword: providers.includes("credential"),
          // On once email sending is set up (Better Auth user.changeEmail);
          // Google sign-ins keep the address Google gives them.
          canChangeEmail:
            Boolean(auth.options.user?.changeEmail?.enabled) &&
            providers.includes("credential"),
          providers,
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/account/password",
      tags: ["Account"],
      summary: "Add a password to an account that signs in with Google only",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ newPassword: z.string().min(8).max(128) }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Password set"), ...errors },
    }),
    async (c) => {
      const { newPassword } = c.req.valid("json");
      await requireMember(c.req.raw.headers);
      await auth.api.setPassword({
        body: { newPassword },
        headers: c.req.raw.headers,
      });
      return c.json({ ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/account",
      tags: ["Account"],
      summary: "Delete the account and everything in it",
      description:
        "CVs, their versions and chat files, sessions and sign-in methods go with the user row (FK cascade); stored files, the picture and photos no other CV uses leave R2 too.",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                /** The account's email, typed to confirm. */
                confirm: z.string(),
              }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema, "Deleted"), ...errors },
    }),
    async (c) => {
      const { confirm } = c.req.valid("json");
      const u = await requireMember(c.req.raw.headers);
      if (confirm.trim().toLowerCase() !== u.email.toLowerCase()) {
        return fail(400, m.settings_delete_mismatch());
      }
      await deleteUserAndFiles(u.id);
      return c.json({ ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/account/avatar",
      tags: ["Account"],
      summary: "Store an uploaded profile picture",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ dataUrl: z.string().max(500_000) }),
            },
          },
        },
      },
      responses: { 200: json(ImageSchema, "The new picture URL"), ...errors },
    }),
    async (c) => {
      const { dataUrl } = c.req.valid("json");
      const u = await requireMember(c.req.raw.headers);
      const match = AVATAR_DATA_URL.exec(dataUrl);
      if (!match) {
        return fail(400, m.settings_photo_failed());
      }
      const { mediaType = "", base64 = "" } = match.groups ?? {};
      if (Buffer.byteLength(base64, "base64") > MAX_AVATAR_BYTES) {
        return fail(400, m.settings_photo_too_large());
      }
      const [existing] = await db
        .select({ providerImage: userAvatar.providerImage })
        .from(userAvatar)
        .where(eq(userAvatar.userId, u.id));
      // Keep the sign-in provider's picture (Google) so "Remove" can restore it.
      const fromProvider =
        u.image && !u.image.startsWith(AVATAR_PATH) ? u.image : null;
      const providerImage = existing ? existing.providerImage : fromProvider;
      await putObject(
        avatarKey(u.id),
        Buffer.from(base64, "base64"),
        mediaType
      );
      await db
        .insert(userAvatar)
        .values({ userId: u.id, mediaType, providerImage })
        .onConflictDoUpdate({
          target: userAvatar.userId,
          set: { mediaType, data: null, updatedAt: new Date() },
        });
      const image = `${AVATAR_PATH}${u.id}?v=${Date.now()}`;
      await db.update(userTable).set({ image }).where(eq(userTable.id, u.id));
      return c.json({ image }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/account/avatar",
      tags: ["Account"],
      summary: "Drop the uploaded picture; back to the Google one, or initials",
      responses: { 200: json(ImageSchema, "The picture now shown"), ...errors },
    }),
    async (c) => {
      const u = await requireMember(c.req.raw.headers);
      const [row] = await db
        .delete(userAvatar)
        .where(eq(userAvatar.userId, u.id))
        .returning({ providerImage: userAvatar.providerImage });
      await deleteObjects([avatarKey(u.id)]);
      const image = row?.providerImage ?? null;
      await db.update(userTable).set({ image }).where(eq(userTable.id, u.id));
      return c.json({ image }, 200);
    }
  );
