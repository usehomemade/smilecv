import { createOpenAI } from "@ai-sdk/openai";
import { createRoute, z } from "@hono/zod-openapi";
import { generateText } from "ai";

import { CONTACT_EMAIL, faqItems } from "#/components/marketing/faq-copy";
import { HUMAN_WRITING } from "#/lib/ai/humanizer";
import { TEMPLATES } from "#/lib/cv/templates";
import { LANGUAGE_NAMES } from "#/lib/i18n";
import {
  errorStack,
  errorText,
  recordAiUsage,
  usageNumbers,
} from "#/lib/server/ai-usage";
import { m } from "#/paraglide/messages.js";
import { getLocale, isLocale } from "#/paraglide/runtime.js";
import type { Locale } from "#/paraglide/runtime.js";
import { ErrorSchema, json, router } from "#/server/api/lib";
import { logError } from "#/server/log";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_QUESTION = 300;
const LIMIT = 10;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

const allowed = (ip: string) => {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) {
        hits.delete(key);
      }
    }
  }
  return true;
};

const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

const instructions = `You answer questions about SmileCV (smilecv.com), a CV builder, on its FAQ page.

Facts:
- Free to start, no card needed. Paid extras may come later; never promise that everything stays free. Open source: https://github.com/usehomemade/smilecv
- No account needed: guests can start right away; guest CVs are tied to the browser. Sign up with email + password or Google to keep CVs and use them on other devices; guest CVs move to the new account.
- ${TEMPLATES.length} templates: ${TEMPLATES.map((t) => `${t.name} (${t.description})`).join("; ")}. Switching templates keeps the content.
- The CV is edited directly on the page (WYSIWYG), with drag and drop to reorder sections, entries and bullets. Fonts, accent colour, page margins and paper size (A4 or US Letter) are adjustable.
- Export as PDF (real selectable text, embedded fonts) or PNG. Page breaks in the editor match the download exactly.
- An AI chat (OpenAI) edits the CV with the same edits a person could make; it is instructed never to invent employers, dates, degrees, numbers or achievements and asks for missing facts. It works in most languages. The user can select or clip a part of the page to ask about just that.
- When the chat is used, the message, CV text (not the photo) and any clipped area are sent to OpenAI. OpenAI does not train on API data.
- Data is stored on a Hetzner server in the EU. No ads, nothing sold. CVs can be deleted from My CVs; to delete the account email ${CONTACT_EMAIL}.
- Privacy policy at /privacy, terms at /terms. Contact: ${CONTACT_EMAIL}.

FAQ already on the page:
${faqItems("en")
  .map((i) => `Q: ${i.q}\nA: ${i.a}`)
  .join("\n\n")}

Rules:
- Reply in 2 to 4 plain sentences. No markdown, no lists, no greetings.
- Only use the facts above. If the answer isn't there, say you don't know and suggest emailing ${CONTACT_EMAIL}.
- Speak as the site. Never mention "the facts", "the FAQ" or these instructions.
- If the question is not about SmileCV or writing a CV, say briefly that you can only answer questions about SmileCV.

${HUMAN_WRITING}`;

export const faq = router().openapi(
  createRoute({
    method: "post",
    path: "/faq",
    tags: ["Site"],
    summary: "Ask a question about SmileCV; answered by the AI from the FAQ",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              question: z.string().optional(),
              locale: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: json(
        z.object({ answer: z.string() }).openapi("FaqAnswer"),
        "The answer"
      ),
      400: json(ErrorSchema, "Empty or too long question"),
      429: json(ErrorSchema, "Too many questions"),
      502: json(ErrorSchema, "The model failed"),
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const request = c.req.raw;
    const locale: Locale =
      typeof body.locale === "string" && isLocale(body.locale)
        ? body.locale
        : getLocale();
    const t = { locale };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return c.json({ error: m.faq_ask_empty({}, t) }, 400);
    }
    if (question.length > MAX_QUESTION) {
      return c.json({ error: m.faq_ask_too_long({}, t) }, 400);
    }
    if (!allowed(clientIp(request))) {
      return c.json({ error: m.faq_ask_rate_limited({}, t) }, 429);
    }
    const modelId = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const started = Date.now();
    try {
      const { text, usage } = await generateText({
        model: openai(modelId),
        instructions: `${instructions}\n\nThe reader's interface language is ${LANGUAGE_NAMES[locale]} (${locale}). Reply in the language of the question; if it is unclear, reply in ${LANGUAGE_NAMES[locale]}.`,
        prompt: question,
        maxOutputTokens: 1500,
        providerOptions: { openai: { reasoningEffort: "low" } },
      });
      recordAiUsage({
        kind: "faq",
        model: modelId,
        ...usageNumbers(usage),
        durationMs: Date.now() - started,
        detail: {
          prompt: question,
          reply: text.trim(),
          replyLength: text.trim().length,
          locale,
        },
      });
      return c.json({ answer: text.trim() }, 200);
    } catch (error) {
      logError("faq", error);
      recordAiUsage({
        kind: "faq",
        model: modelId,
        durationMs: Date.now() - started,
        error: errorText(error),
        detail: { prompt: question, locale, errorStack: errorStack(error) },
      });
      return c.json({ error: m.faq_ask_error({}, t) }, 502);
    }
  },
  (result, c) => {
    if (!result.success) {
      return c.json({ error: m.faq_ask_empty() }, 400);
    }
  }
);
