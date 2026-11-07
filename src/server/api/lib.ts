import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Hook } from "@hono/zod-openapi";
import type { Env } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Every failed request answers with this body; the client throws its text. */
export const ErrorSchema = z
  .object({ error: z.string() })
  .openapi("Error", { description: "What went wrong, ready to show." });

export const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

/** A JSON response with its schema, for createRoute's `responses`. */
export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

/** The error responses every route may give. */
export const errors = {
  400: json(ErrorSchema, "Invalid input"),
  401: json(ErrorSchema, "Not signed in"),
  403: json(ErrorSchema, "Not allowed"),
  404: json(ErrorSchema, "Not found"),
  500: json(ErrorSchema, "Server error"),
};

/** A binary or streamed body, described for the spec only. */
export const binary = (mediaType: string, description: string) => ({
  content: {
    [mediaType]: { schema: z.string().openapi({ format: "binary" }) },
  },
  description,
});

/** Stops the request with an error the client shows as is. */
export const fail = (status: ContentfulStatusCode, message: string): never => {
  throw new HTTPException(status, { message });
};

const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (!result.success) {
    return c.json({ error: z.prettifyError(result.error) }, 400);
  }
};

/** A router whose invalid input answers like every other error. */
export const router = () => new OpenAPIHono({ defaultHook: validationHook });

/** "true" / "false" in a query string. */
export const QueryFlag = z.enum(["true", "false"]);

/** A whole number from a query string. */
export const queryInt = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
