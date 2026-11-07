import { createRoute, z } from "@hono/zod-openapi";

import { errors, json, OkSchema, router } from "#/server/api/lib";
import { log } from "#/server/log";

export const clientErrors = router().openapi(
  createRoute({
    method: "post",
    path: "/client-errors",
    tags: ["Site"],
    summary: "Report an uncaught error from the browser",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              kind: z.enum(["error", "unhandledrejection"]),
              message: z.string().max(4000),
              stack: z.string().max(4000).optional(),
              url: z.string().max(2000),
            }),
          },
        },
        required: true,
      },
    },
    responses: { 200: json(OkSchema, "Logged"), ...errors },
  }),
  (c) => {
    const body = c.req.valid("json");
    log.error({
      action: "client_error",
      client: {
        kind: body.kind,
        url: body.url,
        userAgent: c.req.header("user-agent") ?? null,
      },
      error: { message: body.message, stack: body.stack },
    });
    return c.json({ ok: true }, 200);
  }
);
