import { useEffect } from "react";

import { call } from "#/lib/api";

const MAX_TEXT = 4000;
/** At most this many reports per page load, so a render loop can't flood. */
const MAX_REPORTS = 10;

let sent = 0;

const report = (kind: "error" | "unhandledrejection", reason: unknown) => {
  if (sent >= MAX_REPORTS) {
    return;
  }
  sent += 1;
  const error = reason instanceof Error ? reason : null;
  call((client) =>
    client.api["client-errors"].$post(
      {
        json: {
          kind,
          message: (error?.message ?? String(reason)).slice(0, MAX_TEXT),
          stack: error?.stack?.slice(0, MAX_TEXT),
          url: window.location.href.slice(0, 2000),
        },
      },
      { init: { keepalive: true } }
    )
  ).catch(() => {
    // Reporting must never cause another error.
  });
};

/** Sends uncaught browser errors to the server log. Renders nothing. */
export const ErrorReporter = () => {
  useEffect(() => {
    const onError = (e: ErrorEvent) => report("error", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) =>
      report("unhandledrejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
};
