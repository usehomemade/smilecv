import type { LanguageModelUsage } from "ai";
import { nanoid } from "nanoid";

import { db } from "#/db";
import { aiUsage } from "#/db/schema";
import { costUsd, priceFor, WEB_SEARCH_PER_CALL } from "#/lib/ai/pricing";
import type { UsageDetail } from "#/lib/ai/usage-detail";
import { logError } from "#/server/log";

export type AiKind = "chat" | "translate" | "faq";

export interface AiUsageEntry {
  cachedInputTokens?: number;
  cvId?: string | null;
  detail?: UsageDetail;
  durationMs?: number;
  error?: string | null;
  inputTokens?: number;
  kind: AiKind;
  model: string;
  outputTokens?: number;
  reasoningTokens?: number;
  steps?: number;
  tools?: string[];
  userId?: string | null;
  webSearches?: number;
}

/** Longest string kept in a detail, at each squeeze level. */
const STRING_CAPS = [4000, 1500, 400, 120];
const MAX_DETAIL_BYTES = 20_000;
const DATA_URL = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu;

const squeeze = (value: unknown, cap: number): unknown => {
  if (typeof value === "string") {
    const clean = value.replaceAll(DATA_URL, "[file data]");
    return clean.length > cap ? `${clean.slice(0, cap)}…` : clean;
  }
  if (Array.isArray(value)) {
    return value.map((v) => squeeze(v, cap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, squeeze(v, cap)])
    );
  }
  return value;
};

export const capDetail = (detail: UsageDetail | undefined) => {
  if (!detail) {
    return null;
  }
  for (const cap of STRING_CAPS) {
    const next = squeeze(detail, cap) as UsageDetail;
    if (JSON.stringify(next).length <= MAX_DETAIL_BYTES) {
      return next;
    }
  }
  const last = squeeze(
    { ...detail, steps: detail.steps?.slice(-5) },
    STRING_CAPS.at(-1) ?? 120
  ) as UsageDetail;
  return JSON.stringify(last).length <= MAX_DETAIL_BYTES
    ? last
    : { prices: detail.prices, finishReason: detail.finishReason };
};

export const errorStack = (error: unknown) =>
  error instanceof Error && error.stack
    ? error.stack.split("\n").slice(0, 6).join("\n")
    : undefined;

export const usageNumbers = (usage: LanguageModelUsage | undefined) => ({
  inputTokens: usage?.inputTokens ?? 0,
  outputTokens: usage?.outputTokens ?? 0,
  cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
  reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
});

export const addUsage = (
  a: ReturnType<typeof usageNumbers>,
  b: ReturnType<typeof usageNumbers>
) => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export const NO_USAGE = usageNumbers(undefined);

export const recordAiUsage = (entry: AiUsageEntry) => {
  const n = {
    inputTokens: Math.max(0, Math.round(entry.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.round(entry.outputTokens ?? 0)),
    cachedInputTokens: Math.max(0, Math.round(entry.cachedInputTokens ?? 0)),
    reasoningTokens: Math.max(0, Math.round(entry.reasoningTokens ?? 0)),
    webSearches: Math.max(0, Math.round(entry.webSearches ?? 0)),
  };
  const cost = costUsd(entry.model, n);
  const detail = capDetail({
    ...entry.detail,
    prices: { ...priceFor(entry.model), webSearch: WEB_SEARCH_PER_CALL },
  });
  const save = async () => {
    try {
      await db.insert(aiUsage).values({
        id: nanoid(16),
        userId: entry.userId ?? null,
        cvId: entry.cvId ?? null,
        kind: entry.kind,
        model: entry.model,
        ...n,
        steps: entry.steps ?? 1,
        tools: entry.tools ?? [],
        costUsd: cost.toFixed(6),
        durationMs: Math.max(0, Math.round(entry.durationMs ?? 0)),
        error: entry.error ? entry.error.slice(0, 500) : null,
        detail,
      });
    } catch (error) {
      logError("ai_usage", error);
    }
  };
  save();
};

export const errorText = (error: unknown) => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return typeof error === "string" ? error : "error";
};
