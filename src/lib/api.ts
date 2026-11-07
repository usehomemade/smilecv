import { createIsomorphicFn } from "@tanstack/react-start";
import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";

import type { AppType } from "#/server/api/app";

export type ApiClient = ReturnType<typeof hc<AppType>>;

/** Request headers that describe the page request, not the API call. */
const NOT_FORWARDED = new Set([
  "connection",
  "content-length",
  "content-type",
  "host",
  "transfer-encoding",
]);

/**
 * The typed API client. In the browser it calls /api over the network; on
 * the server (SSR loaders) it calls the Hono app in-process with the page
 * request's cookies, so nothing goes over the network.
 */
const client = createIsomorphicFn()
  .server(async (): Promise<ApiClient> => {
    const [{ app }, { getRequestHeaders }] = await Promise.all([
      import("#/server/api/app"),
      import("@tanstack/react-start/server"),
    ]);
    const incoming = getRequestHeaders();
    return hc<AppType>("http://localhost", {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        for (const [key, value] of incoming) {
          if (!(NOT_FORWARDED.has(key) || headers.has(key))) {
            headers.set(key, value);
          }
        }
        return app.request(input, { ...init, headers });
      },
    });
  })
  .client((): Promise<ApiClient> =>
    Promise.resolve(hc<AppType>(window.location.origin))
  );

export const api = async (): Promise<ApiClient> => await client();

type Success<R> =
  R extends ClientResponse<infer T, infer S, "json">
    ? S extends SuccessStatusCode
      ? T
      : never
    : never;

const errorText = (body: unknown) =>
  typeof body === "object" &&
  body !== null &&
  "error" in body &&
  typeof body.error === "string"
    ? body.error
    : "Request failed";

/**
 * Runs one API call and returns its body. A failed call throws an Error
 * carrying the server's message, the same message the page used to show.
 */
export const call = async <R extends ClientResponse<unknown, number, "json">>(
  request: (client: ApiClient) => Promise<R>
): Promise<Success<R>> => {
  const res = await request(await api());
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new Error(errorText(body));
  }
  return body as Success<R>;
};
