import { openSignupGate } from "#/components/signup-gate";
import { authClient } from "#/lib/auth-client";
import { createCv } from "#/lib/cv/functions";
import type { TemplateId } from "#/lib/cv/templates";
import { ensureDeviceId } from "#/lib/device-id";
import { limitOf } from "#/lib/guest";
import { track } from "#/lib/track";
import { m } from "#/paraglide/messages.js";
import { getLocale } from "#/paraglide/runtime.js";

export const startCv = async ({
  from,
  ...opts
}: {
  template?: TemplateId;
  sample?: boolean;
  from?: "import";
} = {}) => {
  const { data } = await authClient.getSession();
  const guest =
    !data || Boolean((data.user as { isAnonymous?: boolean }).isAnonymous);
  if (!data || (data.user as { isAnonymous?: boolean }).isAnonymous) {
    await ensureDeviceId();
  }
  if (!data) {
    const res = await authClient.signIn.anonymous();
    if (res.error) {
      throw new Error(res.error.message ?? m.common_guest_failed());
    }
  }
  try {
    const created = await createCv({ ...opts, locale: getLocale() });
    let source: "import" | "sample" | "template" | "blank" = "blank";
    if (from) {
      source = from;
    } else if (opts.sample) {
      source = "sample";
    } else if (opts.template) {
      source = "template";
    }
    track("cv_created", {
      from: source,
      guest,
      ...(opts.template ? { template: opts.template } : {}),
    });
    return created;
  } catch (error) {
    // A guest who already has a CV is asked to sign up instead.
    const limit = limitOf(error);
    if (limit) {
      openSignupGate("cv", limit);
    }
    throw error;
  }
};
