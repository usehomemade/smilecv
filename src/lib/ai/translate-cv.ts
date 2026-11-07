import { generateText } from "ai";
import type { LanguageModel, LanguageModelUsage } from "ai";

import type { CV } from "#/lib/cv/schema";
import { logError } from "#/server/log";

/** Fields that are data, not words: never sent for translation. */
const KEEP = new Set([
  "id",
  "url",
  "email",
  "phone",
  "website",
  "photo",
  "columns",
  "sectionOrder",
  "style",
  "language",
]);

const FENCE = /^```(?:json)?\s*|\s*```$/gu;

/** Tokens used by one translation, summed over its parallel requests. */
export interface TranslateUsage {
  durationMs: number;
  error?: string;
  failed: number;
  /** The parts of the CV that failed (kept in the original language). */
  failedSections: string[];
  language: string;
  /** The parts of the CV sent for translation. */
  sections: string[];
  usages: LanguageModelUsage[];
}

const hasText = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasText);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => !KEEP.has(k) && hasText(v));
  }
  return false;
};

const strip = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(strip);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !KEEP.has(k))
        .map(([k, v]) => [k, strip(v)])
    );
  }
  return value;
};

const mergeStrings = (original: unknown, translated: unknown): unknown => {
  if (typeof original === "string") {
    return typeof translated === "string" ? translated : original;
  }
  if (Array.isArray(original)) {
    const list = Array.isArray(translated) ? translated : [];
    return original.map((v, i) => mergeStrings(v, list[i]));
  }
  if (original && typeof original === "object") {
    const t =
      translated && typeof translated === "object"
        ? (translated as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(original).map(([k, v]) => [
        k,
        KEEP.has(k) ? v : mergeStrings(v, t[k]),
      ])
    );
  }
  return original;
};

export const translateCv = async (
  cv: CV,
  language: string,
  model: LanguageModel,
  onUsage?: (usage: TranslateUsage) => void
): Promise<CV> => {
  const started = Date.now();
  const usages: LanguageModelUsage[] = [];
  let failed = 0;
  const failedSections: string[] = [];
  let lastError: string | undefined;
  const parts = Object.entries(cv).filter(
    ([key, value]) => !KEEP.has(key) && hasText(value)
  );
  const translated = await Promise.all(
    parts.map(async ([key, value]) => {
      try {
        const { text, usage } = await generateText({
          model,
          instructions: `Translate the JSON you are given into ${language}. It is part of a CV.
Rules:
- Return ONLY the same JSON structure: same keys, same array lengths, same order. Translate string values only.
- Translate everything a reader sees: job titles, descriptions, bullets, skills, section and group titles, locations' country/city names where they have a common name in ${language}, and month names and words like "Present"/"Heute" in dates (use the usual CV date style in ${language}, e.g. abbreviated months).
- Keep proper names as they are: people, companies, products, schools, hotel names, brand names.
- Keep markup exactly: **bold**, *italic*, __underline__, [label](url) (translate the label, keep the url), line breaks.
- Keep the meaning and tone; don't add or drop information. Natural, professional CV language.`,
          prompt: JSON.stringify(strip(value)),
        });
        usages.push(usage);
        return [
          key,
          mergeStrings(value, JSON.parse(text.replaceAll(FENCE, ""))),
        ];
      } catch (error) {
        logError("translate_cv", error, { section: key });
        failed += 1;
        failedSections.push(key);
        lastError = error instanceof Error ? error.message : String(error);
        return [key, value];
      }
    })
  );
  onUsage?.({
    usages,
    durationMs: Date.now() - started,
    failed,
    error: lastError,
    language,
    sections: parts.map(([key]) => key),
    failedSections,
  });
  return { ...cv, ...Object.fromEntries(translated) } as CV;
};
