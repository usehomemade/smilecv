import { auth } from "#/lib/auth";
import { m } from "#/paraglide/messages.js";
import { fail } from "#/server/api/lib";

export const getSession = async (headers: Headers) =>
  await auth.api.getSession({ headers });

export const requireUser = async (headers: Headers) => {
  const session = await getSession(headers);
  if (!session) {
    return fail(401, m.err_not_signed_in());
  }
  // Banned users keep no sessions, but a ban can land mid-session.
  if ((session.user as { banned?: boolean | null }).banned) {
    return fail(403, m.err_banned());
  }
  return session.user;
};
