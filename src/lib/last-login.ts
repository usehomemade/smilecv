import { call } from "#/lib/api";

/** Set by Better Auth's lastLoginMethod plugin after a sign-in. */
export const LAST_LOGIN_COOKIE = "better-auth.last_used_login_method";

export type LastLoginMethod = "google" | "email" | null;

/**
 * The sign-in method used last time, read on the server so the
 * "Last used" badge is in the first render (no flash).
 */
export const getLastLoginMethod = async (): Promise<LastLoginMethod> =>
  await call((client) => client.api["last-login"].$get());
