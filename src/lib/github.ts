import { call } from "#/lib/api";

export const REPO = "usehomemade/smilecv";
export const REPO_URL = `https://github.com/${REPO}`;

/** Star count (cached on the server for 10 minutes). */
export const getStars = async () =>
  await call((client) => client.api.github.stars.$get());
