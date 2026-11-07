import { createRoute } from "@hono/zod-openapi";

import { json, OkSchema, router } from "#/server/api/lib";

/** Liveness probe for Coolify and Docker. No auth, no work, not logged. */
export const health = router().openapi(
  createRoute({
    method: "get",
    path: "/health",
    tags: ["Site"],
    summary: "Health check",
    responses: { 200: json(OkSchema, "Up") },
  }),
  (c) => c.json({ ok: true }, 200)
);
