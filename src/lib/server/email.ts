import { render } from "@react-email/components";
import { UseSend } from "usesend-js";

import { ActionEmail } from "#/emails/layout";
import { m } from "#/paraglide/messages.js";
import { getLocale } from "#/paraglide/runtime.js";
import type { Locale } from "#/paraglide/runtime.js";

const TRAILING_SLASH = /\/$/u;
const FROM = process.env.EMAIL_FROM ?? "SmileCV <noreply@emails.smilecv.com>";
const usesend = process.env.USESEND_API_KEY
  ? new UseSend(
      process.env.USESEND_API_KEY,
      process.env.USESEND_URL ?? "https://usesend.wust.co"
    )
  : null;

const origin = () =>
  (process.env.BETTER_AUTH_URL ?? "https://smilecv.com").replace(
    TRAILING_SLASH,
    ""
  );

export type AccountEmail = "reset" | "verify" | "change" | "delete";

const COPY = {
  reset: {
    subject: m.email_reset_subject,
    title: m.email_reset_title,
    body: m.email_reset_body,
    button: m.email_reset_button,
  },
  verify: {
    subject: m.email_verify_subject,
    title: m.email_verify_title,
    body: m.email_verify_body,
    button: m.email_verify_button,
  },
  change: {
    subject: m.email_change_subject,
    title: m.email_change_title,
    body: m.email_change_body,
    button: m.email_change_button,
  },
  delete: {
    subject: m.email_delete_subject,
    title: m.email_delete_title,
    body: m.email_delete_body,
    button: m.email_delete_button,
  },
} as const;

export const sendAccountEmail = async (
  kind: AccountEmail,
  opts: { to: string; url: string; email?: string; locale?: Locale }
) => {
  const locale = opts.locale ?? getLocale();
  const t = { locale };
  const copy = COPY[kind];
  const html = await render(
    ActionEmail({
      title: copy.title({}, t),
      body: copy.body({ email: opts.email ?? opts.to }, t),
      button: copy.button({}, t),
      url: opts.url,
      origin: origin(),
      locale,
    })
  );
  const subject = copy.subject({}, t);
  if (!usesend) {
    console.info(`[email] ${kind} → ${opts.to}: ${opts.url}`);
    return;
  }
  const { error } = await usesend.emails.send({
    from: FROM,
    to: opts.to,
    subject,
    html,
  });
  if (error) {
    console.error("[email]", kind, error);
    throw new Error(error.message);
  }
};
