import { createOpenAI } from "@ai-sdk/openai";
import { createRoute, z } from "@hono/zod-openapi";
import {
  UI_MESSAGE_STREAM_HEADERS,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import type { UIMessage } from "ai";
import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "#/db";
import { cv as cvTable, user as userTable } from "#/db/schema";
import { createCvTools } from "#/lib/ai/cv-tools";
import { systemPrompt } from "#/lib/ai/prompt";
import type { UsageStepDetail } from "#/lib/ai/usage-detail";
import { auth } from "#/lib/auth";
import { normalizeCv } from "#/lib/cv/schema";
import { TEMPLATE_IDS } from "#/lib/cv/templates";
import type { TemplateId } from "#/lib/cv/templates";
import {
  GUEST_AI_LIMIT,
  GUEST_LIMIT,
  limitKindFor,
  VERIFY_LIMIT,
} from "#/lib/guest";
import {
  abortControllerFor,
  recordStream,
  releaseAbort,
  replayStream,
  stopStream,
} from "#/lib/server/active-streams";
import {
  addUsage,
  errorStack,
  errorText,
  NO_USAGE,
  recordAiUsage,
  usageNumbers,
} from "#/lib/server/ai-usage";
import { inlineFiles } from "#/lib/server/files";
import { deviceHash, spendDevice } from "#/lib/server/guest-device";
import { externalizePhoto } from "#/lib/server/photos";
import { cleanText, promptOf, stepDetail } from "#/lib/server/usage-capture";
import { m } from "#/paraglide/messages.js";
import { getLocale, isLocale } from "#/paraglide/runtime.js";
import type { Locale } from "#/paraglide/runtime.js";
import { router } from "#/server/api/lib";
import { logError } from "#/server/log";

const totalUsage = (usages: Parameters<typeof usageNumbers>[0][]) => {
  let total = NO_USAGE;
  for (const usage of usages) {
    total = addUsage(total, usageNumbers(usage));
  }
  return total;
};

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isMessage = (value: unknown): value is UIMessage =>
  typeof value === "object" &&
  value !== null &&
  "parts" in value &&
  Array.isArray(value.parts);

const ChatRequest = z.object({
  messages: z
    .array(z.custom<UIMessage>(isMessage).openapi({ type: "object" }))
    .openapi({ description: "The whole conversation (AI SDK UIMessage[])" }),
  cvId: z.string(),
  /** The CV as it is at send time. */
  cv: z.unknown(),
  template: z.string().optional(),
  /** The UI locale; chat replies and errors use it. */
  locale: z.string().optional(),
});

const text = (description: string) => ({
  content: { "text/plain": { schema: z.string() } },
  description,
});

export const chat = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/chat",
      tags: ["Chat"],
      summary: "Send a message to the CV assistant; the reply streams back",
      description:
        "An AI SDK UI message stream (SSE). The reply keeps generating if the page goes away, and /api/chat-stream/{id} replays it.",
      request: {
        body: {
          content: { "application/json": { schema: ChatRequest } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "text/event-stream": { schema: z.string() } },
          description: "UI message stream",
        },
        401: text("Session expired"),
        403: {
          description: "Banned (text) or out of free messages (JSON code)",
        },
        404: text("CV not found"),
      },
    }),
    async (c) => {
      const request = c.req.raw;
      const body = c.req.valid("json");
      const locale: Locale =
        typeof body.locale === "string" && isLocale(body.locale)
          ? body.locale
          : getLocale();
      const t = { locale };

      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) {
        return new Response(m.err_session_expired({}, t), { status: 401 });
      }
      if ((session.user as { banned?: boolean | null }).banned) {
        return new Response(m.err_banned({}, t), { status: 403 });
      }
      const [row] = await db
        .select({ id: cvTable.id })
        .from(cvTable)
        .where(
          and(eq(cvTable.id, body.cvId), eq(cvTable.userId, session.user.id))
        );
      if (!row) {
        return new Response(m.err_cv_not_found({}, t), { status: 404 });
      }

      // Guests and unconfirmed accounts get a few AI messages; count
      // atomically, then refuse.
      const limitKind = limitKindFor(
        session.user as { isAnonymous?: boolean; emailVerified?: boolean }
      );
      if (limitKind) {
        const [used] = await db
          .update(userTable)
          .set({ aiMessages: sql`${userTable.aiMessages} + 1` })
          .where(
            and(
              eq(userTable.id, session.user.id),
              lt(userTable.aiMessages, GUEST_AI_LIMIT)
            )
          )
          .returning({ n: userTable.aiMessages });
        const device =
          limitKind === "guest"
            ? deviceHash(request.headers.get("cookie"))
            : null;
        if (
          !(used && (await spendDevice(device, "aiMessages", GUEST_AI_LIMIT)))
        ) {
          return Response.json(
            { code: limitKind === "guest" ? GUEST_LIMIT : VERIFY_LIMIT },
            { status: 403 }
          );
        }
      }

      const state = {
        account: (session.user as { isAnonymous?: boolean }).isAnonymous
          ? null
          : {
              name: session.user.name,
              email: session.user.email,
              image: session.user.image ?? null,
            },
        cv: normalizeCv(body.cv),
        template: (TEMPLATE_IDS.includes(body.template as TemplateId)
          ? body.template
          : "classic") as TemplateId,
      };
      // Save the new question right away, so a reload while the reply is
      // streaming shows it and resumes the reply below it.
      await db
        .update(cvTable)
        .set({ chat: body.messages.slice(-200) })
        .where(eq(cvTable.id, body.cvId));

      // Only the last 30 messages go to the model; the full history is kept.
      const recent = body.messages.slice(-30);

      const stream = createUIMessageStream({
        originalMessages: body.messages,
        execute: async ({ writer }) => {
          const controller = abortControllerFor(body.cvId);
          const modelId = process.env.OPENAI_MODEL || "gpt-5.4-mini";
          const model = openai(modelId);
          const userId = session.user.id;
          const { cvId } = body;
          // Cost tracking: the reply's steps add up into one ai_usage row.
          const started = Date.now();
          let usage = NO_USAGE;
          let steps = 0;
          let webSearches = 0;
          const toolNames = new Set<string>();
          const stepDetails: UsageStepDetail[] = [];
          const asked = promptOf(body.messages);
          let recorded = false;
          const record = (error?: unknown) => {
            if (recorded) {
              return;
            }
            recorded = true;
            recordAiUsage({
              kind: "chat",
              model: modelId,
              userId,
              cvId,
              ...usage,
              webSearches,
              steps,
              tools: [...toolNames],
              durationMs: Date.now() - started,
              error: error === undefined ? null : errorText(error),
              detail: {
                finishReason: stepDetails.at(-1)?.finishReason,
                steps: stepDetails,
                prompt: asked.prompt,
                attachments: asked.attachments,
                reply: reply || undefined,
                replyLength: reply.length,
                locale,
                errorStack: errorStack(error),
              },
            });
          };
          let reply = "";
          const tools = createCvTools(
            state,
            () => {
              writer.write({
                type: "data-cv",
                data: { cv: state.cv, template: state.template },
                transient: true,
              });
            },
            model,
            (tr) =>
              recordAiUsage({
                kind: "translate",
                model: modelId,
                userId,
                cvId,
                ...totalUsage(tr.usages),
                steps: tr.usages.length + tr.failed,
                durationMs: tr.durationMs,
                error: tr.error ?? null,
                detail: {
                  language: tr.language,
                  sections: tr.sections,
                  failedSections: tr.failedSections,
                },
              })
          );
          const result = streamText({
            model,
            instructions: systemPrompt(
              state.cv,
              state.template,
              locale,
              state.account
            ),
            messages: await convertToModelMessages(
              await inlineFiles(recent, session.user.id)
            ),
            tools: {
              ...tools,
              // OpenAI's hosted search; results come back as sources.
              web_search: openai.tools.webSearch({
                searchContextSize: "medium",
              }),
            },
            stopWhen: stepCountIs(25),
            // Stop in the chat aborts generation (and further CV edits).
            abortSignal: controller.signal,
            onStepEnd: (step) => {
              steps += 1;
              stepDetails.push(stepDetail(step));
              const said = cleanText(step.text);
              if (said) {
                reply = reply ? `${reply}\n\n${said}` : said;
              }
              usage = addUsage(usage, usageNumbers(step.usage));
              for (const call of step.toolCalls) {
                toolNames.add(call.toolName);
                if (call.toolName === "web_search") {
                  webSearches += 1;
                }
              }
            },
            onFinish: () => {
              releaseAbort(body.cvId, controller);
              record();
            },
            onAbort: () => record("aborted"),
            onError: ({ error }) => record(error),
            providerOptions: { openai: { strictJsonSchema: false } },
          });
          writer.merge(
            toUIMessageStream({ stream: result.stream, sendSources: true })
          );
        },
        onError: (error) => {
          logError("chat", error, { cvId: body.cvId });
          return m.ai_error_model({}, t);
        },
        onEnd: async ({ messages }) => {
          await db
            .update(cvTable)
            .set({
              data: await externalizePhoto(state.cv),
              template: state.template,
              chat: messages.slice(-200),
              updatedAt: new Date(),
            })
            .where(eq(cvTable.id, body.cvId));
        },
      });
      return createUIMessageStreamResponse({
        stream,
        // Keeps generating if the page goes away, and lets a reload replay it.
        consumeSseStream: async ({ stream: copy }) => {
          try {
            await recordStream(body.cvId, copy);
          } catch (error) {
            logError("chat_record", error, { cvId: body.cvId });
          }
        },
      });
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/chat-stream/{id}",
      tags: ["Chat"],
      summary: "Resume a reply that is still streaming (after a page reload)",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          content: { "text/event-stream": { schema: z.string() } },
          description: "The rest of the reply",
        },
        204: { description: "Nothing is streaming" },
        401: text("Not signed in"),
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }
      const [row] = await db
        .select({ id: cvTable.id })
        .from(cvTable)
        .where(
          and(
            eq(cvTable.id, c.req.valid("param").id),
            eq(cvTable.userId, session.user.id)
          )
        );
      const stream = row ? replayStream(row.id) : null;
      if (!stream) {
        return new Response(null, { status: 204 });
      }
      return new Response(stream.pipeThrough(new TextEncoderStream()), {
        headers: UI_MESSAGE_STREAM_HEADERS,
      });
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/chat-stream/{id}",
      tags: ["Chat"],
      summary: "The user pressed Stop: end the reply on the server too",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        204: { description: "Stopped (or nothing was streaming)" },
        401: { description: "Not signed in" },
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return new Response(null, { status: 401 });
      }
      const [row] = await db
        .select({ id: cvTable.id })
        .from(cvTable)
        .where(
          and(
            eq(cvTable.id, c.req.valid("param").id),
            eq(cvTable.userId, session.user.id)
          )
        );
      if (row) {
        stopStream(row.id);
      }
      return new Response(null, { status: 204 });
    }
  );
