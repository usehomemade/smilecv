import { initLogger, log } from "evlog";
import type { DrainContext } from "evlog";
import { sendBatchToOTLP } from "evlog/otlp";
import { createDrainPipeline } from "evlog/pipeline";

export { log } from "evlog";

const SERVICE = "smilecv";

/** OTEL_EXPORTER_OTLP_HEADERS: `key=value,key2=value2` (values URL-encoded). */
const parseHeaders = (raw: string | undefined) => {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0) {
      headers[pair.slice(0, at).trim()] = decodeURIComponent(
        pair.slice(at + 1).trim()
      );
    }
  }
  return headers;
};

/**
 * Ships events to OpenObserve over OTLP in batches. Without
 * OTEL_EXPORTER_OTLP_ENDPOINT (local dev) events only go to the console.
 */
const otlpDrain = () => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return;
  }
  const config = {
    endpoint,
    serviceName: SERVICE,
    semanticConventions: true,
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  };
  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 50, intervalMs: 5000 },
  });
  return pipeline(async (batch) => {
    await sendBatchToOTLP(
      batch.map((ctx) => ctx.event),
      config
    );
  });
};

export const drain = otlpDrain();

initLogger({ env: { service: SERVICE }, drain });

/** An error worth keeping, with what was being done when it happened. */
export const logError = (
  action: string,
  error: unknown,
  fields: Record<string, unknown> = {}
) => {
  log.error({
    action,
    ...fields,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
  });
};
