import { createFileRoute } from "@tanstack/react-router";

import { app } from "#/server/api/app";

/** Every /api request goes to the Hono app (src/server/api/app.ts). */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => app.fetch(request),
    },
  },
});
