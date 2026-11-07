import { call } from "#/lib/api";

/** What the settings page shows: profile, sign-in methods. */
export const getAccount = async () =>
  await call((client) => client.api.account.$get());

/** Adds a password to an account that signs in with Google only. */
export const setAccountPassword = async (json: { newPassword: string }) =>
  await call((client) => client.api.account.password.$post({ json }));

/**
 * Deletes the account and everything in it. CVs, their versions and chat
 * files, sessions and sign-in methods go with the user row (FK cascade);
 * stored files, the picture and photos no other CV uses leave R2 too.
 */
export const deleteAccount = async (json: { confirm: string }) =>
  await call((client) => client.api.account.$delete({ json }));

/** Stores an uploaded profile picture and points the user's image at it. */
export const uploadAvatar = async (json: { dataUrl: string }) =>
  await call((client) => client.api.account.avatar.$put({ json }));

/** Drops the uploaded picture; back to the Google one, or to initials. */
export const removeAvatar = async () =>
  await call((client) => client.api.account.avatar.$delete());
