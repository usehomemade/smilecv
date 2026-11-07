import type { z } from "@hono/zod-openapi";

import { call } from "#/lib/api";
import type { AnalyticsConfigSchema } from "#/server/api/routes/meta";

/** Umami settings for the page; null when analytics are off. */
export const getAnalyticsConfig = async () =>
  await call((client) => client.api["analytics-config"].$get());

export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>;
