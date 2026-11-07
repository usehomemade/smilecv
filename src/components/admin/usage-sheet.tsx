import {
  Attachment01Icon,
  Cancel01Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  fmtDate,
  fmtDuration,
  fmtInt,
  fmtUsd,
  Tag,
} from "#/components/admin/ui";
import { Icon } from "#/components/icon";
import { getAdminUsage } from "#/lib/admin/functions";
import { priceFor, WEB_SEARCH_PER_CALL } from "#/lib/ai/pricing";
import type { UsageDetail, UsageStepDetail } from "#/lib/ai/usage-detail";
import { m } from "#/paraglide/messages.js";

type Usage = NonNullable<Awaited<ReturnType<typeof getAdminUsage>>>;

export const kindLabel = (kind: string) => {
  if (kind === "chat") {
    return m.admin_kind_chat();
  }
  if (kind === "translate") {
    return m.admin_kind_translate();
  }
  if (kind === "faq") {
    return m.admin_kind_faq();
  }
  return kind;
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="border-b py-4 first:pt-0 last:border-b-0">
    <h3 className="mb-2.5 text-[13px] font-semibold">{title}</h3>
    {children}
  </section>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
    <dt className="text-muted-foreground shrink-0">{label}</dt>
    <dd className="min-w-0 truncate text-end">{children}</dd>
  </div>
);

const Overview = ({ usage, detail }: { usage: Usage; detail: UsageDetail }) => (
  <Section title={m.admin_usage_overview()}>
    <dl>
      <Row label={m.admin_col_user()}>
        {usage.userId ? (
          <Link
            className="underline-offset-2 hover:underline"
            params={{ id: usage.userId }}
            to="/admin/users/$id"
          >
            {usage.isAnonymous
              ? m.admin_guest()
              : usage.userEmail || usage.userId}
          </Link>
        ) : (
          "–"
        )}
      </Row>
      <Row label={m.admin_col_cv()}>
        {usage.cvId ? (
          <Link
            className="underline-offset-2 hover:underline"
            params={{ id: usage.cvId }}
            to="/admin/cvs/$id"
          >
            {usage.cvTitle || usage.cvId}
          </Link>
        ) : (
          "–"
        )}
      </Row>
      <Row label={m.admin_col_model()}>{usage.model}</Row>
      {detail.finishReason ? (
        <Row label={m.admin_finish_reason()}>{detail.finishReason}</Row>
      ) : null}
      <Row label={m.admin_col_duration()}>{fmtDuration(usage.durationMs)}</Row>
      <Row label={m.admin_usage_steps()}>{fmtInt(usage.steps)}</Row>
      {detail.locale ? (
        <Row label={m.admin_locale()}>{detail.locale}</Row>
      ) : null}
    </dl>
  </Section>
);

const ErrorSection = ({ error, stack }: { error: string; stack?: string }) => (
  <Section title={m.admin_error()}>
    <p className="text-destructive text-[13px]">{error}</p>
    {stack ? (
      <pre className="bg-foreground/[0.04] mt-2 overflow-x-auto rounded-[10px] p-3 font-mono text-[11.5px] leading-relaxed">
        {stack}
      </pre>
    ) : null}
  </Section>
);

const TranslationSection = ({ detail }: { detail: UsageDetail }) => (
  <Section title={m.admin_translation()}>
    <dl>
      <Row label={m.admin_target_language()}>{detail.language}</Row>
    </dl>
    {detail.sections?.length ? (
      <div className="mt-2 flex flex-wrap gap-1">
        {detail.sections.map((s) => (
          <Tag
            key={s}
            tone={detail.failedSections?.includes(s) ? "danger" : "muted"}
          >
            {s}
          </Tag>
        ))}
      </div>
    ) : null}
    {detail.failedSections?.length ? (
      <p className="text-destructive mt-2 text-[12.5px]">
        {m.admin_failed_sections({ list: detail.failedSections.join(", ") })}
      </p>
    ) : null}
  </Section>
);

const CostMath = ({ usage, detail }: { usage: Usage; detail: UsageDetail }) => {
  const current = priceFor(usage.model);
  const p = detail.prices ?? { ...current, webSearch: WEB_SEARCH_PER_CALL };
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const lines = [
    {
      label: m.admin_cost_input(),
      tokens: usage.inputTokens - cached,
      unit: p.input,
    },
    { label: m.admin_cost_cached(), tokens: cached, unit: p.cachedInput },
    {
      label: m.admin_cost_output(),
      tokens: usage.outputTokens,
      unit: p.output,
    },
  ];
  return (
    <Section title={m.admin_col_cost()}>
      <table className="w-full text-[13px] tabular-nums">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}>
              <td className="text-muted-foreground py-1">{l.label}</td>
              <td className="text-muted-foreground py-1 text-end">
                {m.admin_cost_tokens_times({
                  tokens: fmtInt(l.tokens),
                  price: fmtUsd(l.unit),
                })}
              </td>
              <td className="w-[90px] py-1 text-end">
                {fmtUsd((l.tokens * l.unit) / 1_000_000)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="text-muted-foreground py-1">
              {m.admin_usage_searches()}
            </td>
            <td className="text-muted-foreground py-1 text-end">
              {m.admin_cost_calls_times({
                count: fmtInt(usage.webSearches),
                price: fmtUsd(p.webSearch),
              })}
            </td>
            <td className="py-1 text-end">
              {fmtUsd(usage.webSearches * p.webSearch)}
            </td>
          </tr>
          <tr className="border-t">
            <td className="pt-2 font-medium" colSpan={2}>
              {m.admin_cost_total()}
            </td>
            <td className="pt-2 text-end font-semibold">
              {fmtUsd(usage.costUsd)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-muted-foreground mt-2 text-[12px]">
        {m.admin_cost_note({ reasoning: fmtInt(usage.reasoningTokens) })}
        {detail.prices ? "" : ` ${m.admin_cost_current_prices()}`}
      </p>
    </Section>
  );
};

const SHORT = 700;

/** OpenAI's inline citation markers, in rows saved before they were cut. */
const CITATIONS = /\uE200[^\uE201]*\uE201/gu;

const LongText = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const clean = text.replaceAll(CITATIONS, "");
  const long = clean.length > SHORT;
  const shown = long && !open ? `${clean.slice(0, SHORT)}…` : clean;
  return (
    <div>
      <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
        {shown}
      </p>
      {long ? (
        <button
          className="text-muted-foreground hover:text-foreground mt-1 cursor-pointer text-[12.5px] underline-offset-2 hover:underline"
          onClick={toggle}
          type="button"
        >
          {open ? m.admin_show_less() : m.admin_show_more()}
        </button>
      ) : null}
    </div>
  );
};

const PromptSection = ({
  detail,
  isFaq,
}: {
  detail: UsageDetail;
  isFaq: boolean;
}) => (
  <Section title={isFaq ? m.admin_question() : m.admin_prompt()}>
    {detail.prompt ? <LongText text={detail.prompt} /> : null}
    {detail.attachments?.length ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {detail.attachments.map((a, i) => (
          <span
            className="bg-foreground/[0.05] inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]"
            // oxlint-disable-next-line react/no-array-index-key -- names can repeat
            key={i}
          >
            <Icon className="size-3" icon={Attachment01Icon} />
            {a}
          </span>
        ))}
      </div>
    ) : null}
  </Section>
);

const WWW = /^www\./u;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(WWW, "");
  } catch {
    return url;
  }
};

const StepText = ({ text }: { text: string }) => (
  <div className="border-foreground/10 text-muted-foreground mt-2 border-s-2 ps-2.5">
    <LongText text={text} />
  </div>
);

const Step = ({ step, index }: { step: UsageStepDetail; index: number }) => (
  <li className="bg-foreground/[0.03] ring-foreground/[0.06] rounded-[12px] p-3 ring-1">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-[13px] font-medium">
        {m.admin_step_n({ n: index + 1 })}
      </span>
      <span className="text-muted-foreground text-[12px] tabular-nums">
        {m.admin_step_tokens({
          input: fmtInt(step.inputTokens),
          output: fmtInt(step.outputTokens),
          cached: fmtInt(step.cachedInputTokens),
          reasoning: fmtInt(step.reasoningTokens),
        })}
        {step.finishReason ? ` · ${step.finishReason}` : ""}
      </span>
    </div>
    {step.tools.length > 0 ? (
      <ul className="mt-2 flex flex-col gap-1.5">
        {step.tools.map((t, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- calls are ordered
          <li className="min-w-0" key={i}>
            <span className="font-mono text-[12px] font-medium">{t.name}</span>
            {t.args ? (
              <code className="bg-background text-muted-foreground ring-foreground/[0.06] mt-0.5 block overflow-x-auto rounded-[8px] px-2 py-1 font-mono text-[11.5px] break-all whitespace-pre-wrap ring-1">
                {t.args}
              </code>
            ) : null}
            {t.error ? (
              <span className="text-destructive block text-[12px]">
                {t.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    ) : null}
    {step.searches.length > 0 ? (
      <ul className="mt-2 flex flex-col gap-1.5">
        {step.searches.map((s, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- searches are ordered
          <li className="min-w-0 text-[12.5px]" key={i}>
            <span className="font-mono text-[12px] font-medium">
              {/* oxlint-disable-next-line i18n/jsx-text -- the tool's name, not UI text */}
              web_search
            </span>{" "}
            {s.query ? (
              <span className="text-foreground">{s.query}</span>
            ) : null}
            {s.urls.length > 0 ? (
              <span className="mt-1 flex flex-wrap gap-1">
                {s.urls.map((u) => (
                  <a
                    className="bg-background text-muted-foreground ring-foreground/[0.08] hover:text-foreground rounded-full px-2 py-0.5 text-[11.5px] ring-1"
                    href={u}
                    key={u}
                    rel="noopener noreferrer"
                    target="_blank"
                    title={u}
                  >
                    {hostOf(u)}
                  </a>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    ) : null}
    {step.text ? <StepText text={step.text} /> : null}
  </li>
);

const Body = ({ usage }: { usage: Usage }) => {
  const detail: UsageDetail = usage.detailJson
    ? (JSON.parse(usage.detailJson) as UsageDetail)
    : {};
  const isFaq = usage.kind === "faq";
  return (
    <>
      <Overview detail={detail} usage={usage} />
      <CostMath detail={detail} usage={usage} />
      {usage.error ? (
        <ErrorSection error={usage.error} stack={detail.errorStack} />
      ) : null}
      {detail.language ? <TranslationSection detail={detail} /> : null}
      {detail.prompt || detail.attachments?.length ? (
        <PromptSection detail={detail} isFaq={isFaq} />
      ) : null}
      {detail.reply ? (
        <Section title={isFaq ? m.admin_answer() : m.admin_reply()}>
          <LongText text={detail.reply} />
          {(detail.replyLength ?? 0) > detail.reply.length ? (
            <p className="text-muted-foreground mt-1.5 text-[12px]">
              {m.admin_reply_cut({ count: fmtInt(detail.replyLength ?? 0) })}
            </p>
          ) : null}
        </Section>
      ) : null}
      {detail.steps?.length ? (
        <Section title={m.admin_steps_title()}>
          <ol className="flex flex-col gap-2.5">
            {detail.steps.map((step, i) => (
              <Step
                index={i}
                // oxlint-disable-next-line react/no-array-index-key -- steps are ordered and never reordered
                key={i}
                step={
                  step.text === detail.reply
                    ? { ...step, text: undefined }
                    : step
                }
              />
            ))}
          </ol>
        </Section>
      ) : null}
      {usage.detailJson ? null : (
        <p className="text-muted-foreground pt-4 text-[12.5px]">
          {m.admin_no_detail()}
        </p>
      )}
    </>
  );
};

export const UsageSheet = ({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) => {
  // The loaded usage, tagged with its id so a new id reads as loading again.
  const [loaded, setLoaded] = useState<{
    id: string;
    usage: Usage | null;
  } | null>(null);
  const usage = loaded?.id === id ? loaded.usage : undefined;
  useEffect(() => {
    let live = true;
    getAdminUsage({ id })
      .then((u) => live && setLoaded({ id, usage: u }))
      .catch(() => live && setLoaded({ id, usage: null }));
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={m.admin_usage_detail()}
      className="fade-in-0 slide-in-from-right-4 animate-in bg-background fixed inset-y-0 right-0 z-40 flex w-full flex-col border-s shadow-[0_0_0_1px_rgba(0,0,0,0.02),-16px_0_48px_-12px_rgba(0,0,0,0.18)] duration-200 sm:w-[min(600px,92vw)]"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            {usage ? kindLabel(usage.kind) : m.admin_usage_detail()}
            {usage?.error ? <Tag tone="danger">{m.admin_error()}</Tag> : null}
          </p>
          {usage ? (
            <p className="text-muted-foreground text-[12.5px]">
              {fmtDate(usage.createdAt)}
            </p>
          ) : null}
        </div>
        <button
          aria-label={m.admin_close()}
          className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-full"
          onClick={onClose}
          type="button"
        >
          <Icon className="size-4" icon={Cancel01Icon} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {usage === undefined ? (
          <p className="text-muted-foreground py-10 text-center text-[13px]">
            {m.admin_loading()}
          </p>
        ) : null}
        {usage === null ? (
          <p className="text-muted-foreground py-10 text-center text-[13px]">
            {m.admin_usage_missing()}
          </p>
        ) : null}
        {usage ? <Body usage={usage} /> : null}
      </div>
    </aside>
  );
};
