import { OpenAPIHono } from "@hono/zod-openapi";
import { evlog } from "evlog/hono";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { auth } from "#/lib/auth";
import { admin } from "#/server/api/admin/routes";
import { accountRoutes } from "#/server/api/routes/account";
import { chat } from "#/server/api/routes/chat";
import { clientErrors } from "#/server/api/routes/client-errors";
import { cvs } from "#/server/api/routes/cvs";
import { exportCv } from "#/server/api/routes/export";
import { faq } from "#/server/api/routes/faq";
import { files } from "#/server/api/routes/files";
import { meta } from "#/server/api/routes/meta";
// Sets up the logger (and its OpenObserve drain) before any request.
import "#/server/log";

const base = new OpenAPIHono().basePath("/api");

// One wide event per request (method, path, status, duration, errors).
base.use(evlog());

// Better Auth owns /api/auth/* (sign-in, OAuth callbacks, sessions).
base.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

/** Every server endpoint of the app; Start mounts it at /api/$. */
export const app = base
  .route("/", meta)
  .route("/", cvs)
  .route("/", accountRoutes)
  .route("/admin", admin)
  .route("/", files)
  .route("/", chat)
  .route("/", exportCv)
  .route("/", faq)
  .route("/", clientErrors);

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "SmileCV API",
    version: "1.0.0",
    description:
      "The SmileCV server API. Authentication (Better Auth) lives under /api/auth/*.",
  },
});

/** Thrown errors answer as `{ error }`, the message the page shows. */
const onError: ErrorHandler = (problem, c) =>
  problem instanceof HTTPException
    ? c.json({ error: problem.message }, problem.status)
    : c.json({ error: problem.message }, 500);

app.onError(onError);

export type AppType = typeof app;
