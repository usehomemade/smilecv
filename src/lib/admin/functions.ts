import { call } from "#/lib/api";

const page = (value: number | undefined) =>
  value === undefined ? undefined : String(value);

/** Whether the visitor may open /admin (used by the route guard). */
export const getAdminAccess = async () =>
  await call((client) => client.api.admin.access.$get());

/** Numbers for the overview: people, CVs, AI spend, and 30 days of cost. */
export const getAdminOverview = async () =>
  await call((client) => client.api.admin.overview.$get());

/** Users with their CV count, AI use, spend and last activity. */
export const listAdminUsers = async (query: {
  q?: string;
  filter?: "all" | "registered" | "guests" | "banned";
  page?: number;
}) =>
  await call((client) =>
    client.api.admin.users.$get({
      query: { ...query, page: page(query.page) },
    })
  );

/** One user: profile, sign-in methods, CVs, files, AI spend. */
export const getAdminUser = async ({ id }: { id: string }) =>
  await call((client) => client.api.admin.users[":id"].$get({ param: { id } }));

/** A CV with its chat, read-only, for any owner. */
export const getAdminCv = async ({ id }: { id: string }) =>
  await call((client) => client.api.admin.cvs[":id"].$get({ param: { id } }));

/** Bans a user: no new sessions, current ones signed out. */
export const banAdminUser = async ({
  id,
  ...json
}: {
  id: string;
  reason?: string;
  /** Ban length in days; none bans until lifted. */
  days?: number;
}) =>
  await call((client) =>
    client.api.admin.users[":id"].ban.$post({ param: { id }, json })
  );

export const unbanAdminUser = async ({ id }: { id: string }) =>
  await call((client) =>
    client.api.admin.users[":id"].unban.$post({ param: { id } })
  );

/** Deletes a user and everything they made (FK cascade); AI usage stays. */
export const deleteAdminUser = async ({ id }: { id: string }) =>
  await call((client) =>
    client.api.admin.users[":id"].$delete({ param: { id } })
  );

/** Every file attached in a chat, newest first. */
export const listAdminFiles = async (query: { q?: string; page?: number }) =>
  await call((client) =>
    client.api.admin.files.$get({
      query: { ...query, page: page(query.page) },
    })
  );

/** AI requests, newest first, with tokens and cost. */
export const listAdminUsage = async ({
  errors,
  ...query
}: {
  kind?: "all" | "chat" | "translate" | "faq";
  userId?: string;
  errors?: boolean;
  page?: number;
}) =>
  await call((client) =>
    client.api.admin.usage.$get({
      query: {
        ...query,
        errors: errors ? "true" : undefined,
        page: page(query.page),
      },
    })
  );

/** One AI request with everything recorded about it. */
export const getAdminUsage = async ({ id }: { id: string }) =>
  await call((client) => client.api.admin.usage[":id"].$get({ param: { id } }));

/**
 * Emails the user a confirmation link (in the admin's language). Also works
 * for an already confirmed address when the admin chooses to send anyway.
 */
export const sendAdminVerification = async ({ id }: { id: string }) =>
  await call((client) =>
    client.api.admin.users[":id"]["verification-email"].$post({
      param: { id },
    })
  );

/**
 * Marks the email as confirmed or not. Unconfirmed accounts get the guest
 * limits again (src/lib/guest.ts limitKindFor).
 */
export const setAdminEmailVerified = async ({
  id,
  verified,
}: {
  id: string;
  verified: boolean;
}) =>
  await call((client) =>
    client.api.admin.users[":id"]["email-verified"].$put({
      param: { id },
      json: { verified },
    })
  );
