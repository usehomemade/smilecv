import { call } from "#/lib/api";

/** How many CVs exist (cached on the server for a minute). */
export const getCvCount = async () =>
  await call((client) => client.api.stats.cvs.$get());
