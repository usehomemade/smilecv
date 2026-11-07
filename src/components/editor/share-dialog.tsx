import {
  AiChat02Icon,
  ArrowUpRight01Icon,
  Globe02Icon,
  Link01Icon,
  Linkedin01Icon,
  LoaderCircleIcon,
  Mail01Icon,
  NewTwitterIcon,
  QrCodeIcon,
  SquareLock02Icon,
  Tick02Icon,
  UnfoldMoreIcon,
  WhatsappIcon,
} from "@hugeicons-pro/core-stroke-rounded";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { encode } from "uqr";

import { Icon } from "#/components/icon";
import type { IconSvgElement } from "#/components/icon";
import { CvThumb } from "#/components/primitives";
import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { getCv } from "#/lib/cv/functions";
import type { CV } from "#/lib/cv/schema";
import { setSharing } from "#/lib/cv/share";
import { track } from "#/lib/track";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages.js";

export interface ShareState {
  shareChat: boolean;
  shareId: string | null;
}

export const shareUrl = (shareId: string) => {
  // Rendered on the server too, where there is no window.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/s/${shareId}`;
};

const PROTOCOL = /^https?:\/\//u;

interface Preview {
  cv: CV;
  hasChat: boolean;
  template: string;
}

type Access = "public" | "private";

/** Runs `work` with the busy flag on, and turns it off however it ends. */
const whileBusy = async <T,>(
  setBusy: (busy: boolean) => void,
  work: () => Promise<T>
) => {
  setBusy(true);
  try {
    return await work();
  } finally {
    setBusy(false);
  }
};

const usePreview = (cvId: string, open: boolean) => {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const row = await getCv({ id: cvId });
        if (live && row) {
          setPreview({
            cv: row.data,
            template: row.template,
            hasChat: row.chatJson !== "[]",
          });
        }
      } catch {
        // The preview is decoration; sharing works without it.
      }
    };
    load();
    return () => {
      live = false;
    };
  }, [cvId, open]);
  return preview;
};

const Hero = ({
  preview,
  shared,
}: {
  preview: Preview | null;
  shared: boolean;
}) => {
  const accent = preview?.cv.style?.accent;
  return (
    <div
      aria-hidden
      className="bg-surface relative h-[176px] overflow-hidden rounded-[16px]"
      style={
        accent
          ? {
              backgroundImage: `radial-gradient(80% 90% at 50% 0%, color-mix(in oklch, ${accent} 16%, transparent), transparent 70%)`,
            }
          : undefined
      }
    >
      <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_62%,transparent_98%)]">
        <div
          className={cn(
            "absolute top-5 left-1/2 w-[148px] -translate-x-1/2 rotate-[-2.5deg] transition-[opacity,filter] duration-300",
            !shared && "opacity-60 grayscale"
          )}
        >
          <div className="overflow-hidden rounded-[6px] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_-8px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.05] [backface-visibility:hidden]">
            {preview ? (
              <CvThumb cv={preview.cv} template={preview.template} />
            ) : (
              <div className="aspect-[210/297] bg-white" />
            )}
          </div>
        </div>
      </div>
      {shared ? null : (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-foreground text-background flex size-10 items-center justify-center rounded-full shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)]">
            <Icon className="size-[18px]" icon={SquareLock02Icon} />
          </span>
        </span>
      )}
    </div>
  );
};

const LinkRow = ({
  url,
  copied,
  onCopy,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
}) => {
  const bare = url.replace(PROTOCOL, "");
  const cut = bare.indexOf("/");
  const host = cut === -1 ? bare : bare.slice(0, cut);
  const path = cut === -1 ? "" : bare.slice(cut);
  return (
    <div className="bg-surface flex h-12 items-center gap-1 rounded-[14px] p-1 pl-3.5">
      <Icon
        className="text-muted-foreground size-4 shrink-0"
        icon={Link01Icon}
      />
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center pl-1.5 text-left text-[13px] outline-none"
        onClick={onCopy}
        title={url}
        type="button"
      >
        <span className="text-muted-foreground hidden truncate sm:inline">
          {host}
        </span>
        <span className="shrink-0 font-medium">{path}</span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="text-muted-foreground hover:bg-background rounded-[10px]"
              nativeButton={false}
              render={
                <a
                  aria-label={m.share_open_page()}
                  href={url}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="icon-lg"
              variant="ghost"
            />
          }
        >
          <Icon icon={ArrowUpRight01Icon} />
        </TooltipTrigger>
        <TooltipContent>{m.share_open_page()}</TooltipContent>
      </Tooltip>
      <Button className="h-10 min-w-[104px] rounded-[10px]" onClick={onCopy}>
        <Icon
          data-icon="inline-start"
          icon={copied ? Tick02Icon : Link01Icon}
        />
        {copied ? m.share_copied() : m.share_copy_link()}
      </Button>
    </div>
  );
};

const PrivateRow = ({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: () => void;
}) => (
  <div className="bg-surface flex h-12 items-center gap-2 rounded-[14px] p-1 pl-3.5">
    <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">
      {m.share_private_note()}
    </span>
    <Button className="h-10 rounded-[10px]" disabled={busy} onClick={onCreate}>
      <Icon
        className={busy ? "animate-spin" : undefined}
        data-icon="inline-start"
        icon={busy ? LoaderCircleIcon : Link01Icon}
      />
      {m.share_create_link()}
    </Button>
  </div>
);

const accessOptions = (): Record<
  Access,
  { icon: IconSvgElement; label: string; hint: string }
> => ({
  public: {
    icon: Globe02Icon,
    label: m.share_access_public(),
    hint: m.share_access_public_hint(),
  },
  private: {
    icon: SquareLock02Icon,
    label: m.share_access_private(),
    hint: m.share_access_private_hint(),
  },
});

const RowIcon = ({ icon }: { icon: IconSvgElement }) => (
  <span className="bg-surface text-foreground/80 flex size-8 shrink-0 items-center justify-center rounded-[10px]">
    <Icon className="size-4" icon={icon} />
  </span>
);

const AccessSelect = ({
  access,
  disabled,
  onChange,
}: {
  access: Access;
  disabled: boolean;
  onChange: (value: Access | null) => void;
}) => {
  const options = accessOptions();
  const current = options[access];
  return (
    <Select
      disabled={disabled}
      modal={false}
      onValueChange={onChange}
      value={access}
    >
      <SelectTrigger
        aria-label={m.share_access_label()}
        className="hover:bg-foreground/[0.025] data-popup-open:bg-foreground/[0.025] w-full cursor-pointer gap-3 rounded-[12px] border-0 py-2 pr-2.5 pl-2 disabled:opacity-100 data-[size=default]:h-auto dark:bg-transparent [&>svg:last-child]:hidden"
      >
        <RowIcon icon={current.icon} />
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[13px] font-medium">
            {current.label}
          </span>
          <span className="text-muted-foreground truncate text-[12px]">
            {access === "public" ? current.hint : m.share_access_private_note()}
          </span>
        </span>
        <Icon
          className={cn(
            "text-muted-foreground size-4 shrink-0",
            disabled && "animate-spin"
          )}
          icon={disabled ? LoaderCircleIcon : UnfoldMoreIcon}
        />
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="w-[288px] rounded-[16px] p-1"
      >
        {(Object.keys(options) as Access[]).map((key) => (
          <SelectItem
            className="cursor-pointer gap-3 rounded-[12px] py-2 pr-9 pl-2"
            key={key}
            value={key}
          >
            <Icon
              className="text-muted-foreground size-4"
              icon={options[key].icon}
            />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium">
                {options[key].label}
              </span>
              <span className="text-muted-foreground text-[12px]">
                {options[key].hint}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const ChatOption = ({
  checked,
  disabled,
  empty,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  empty: boolean;
  onChange: (checked: boolean) => void;
}) => (
  // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the Switch inside is the control
  <label className="hover:bg-foreground/[0.025] flex cursor-pointer items-center gap-3 rounded-[12px] py-2 pr-3 pl-2 has-data-disabled:cursor-default">
    <RowIcon icon={AiChat02Icon} />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[13px] font-medium">{m.share_chat()}</span>
      <span className="text-muted-foreground text-[12px]">
        {empty ? m.share_chat_empty() : m.share_chat_hint()}
      </span>
    </span>
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      size="sm"
    />
  </label>
);

const TARGET =
  "flex size-9 cursor-pointer items-center justify-center rounded-full text-foreground/80 ring-1 ring-foreground/[0.08] outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94]";

const QrCode = ({
  value,
  className,
}: {
  value: string;
  className?: string;
}) => {
  const { d, size } = useMemo(() => {
    const qr = encode(value, { border: 0 });
    let path = "";
    for (const [y, row] of qr.data.entries()) {
      for (const [x, on] of row.entries()) {
        if (on) {
          path += `M${x} ${y}h1v1h-1z`;
        }
      }
    }
    return { d: path, size: qr.size };
  }, [value]);
  return (
    <span className="rounded-[12px] bg-white p-3 ring-1 ring-black/[0.06]">
      <svg
        aria-label={m.share_qr_label()}
        className={className}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- inline SVG drawn from data; role="img" plus aria-label is how an inline SVG gets announced
        role="img"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${size} ${size}`}
      >
        <path d={d} fill="#0a0a0a" />
      </svg>
    </span>
  );
};

const ShareTargets = ({ url, name }: { url: string; name: string }) => {
  const targets = useMemo(() => {
    const u = encodeURIComponent(url);
    const text = name ? m.share_text_named({ name }) : m.share_text_mine();
    const t = encodeURIComponent(text);
    return [
      {
        label: "LinkedIn",
        icon: Linkedin01Icon,
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
      },
      {
        label: "X",
        icon: NewTwitterIcon,
        href: `https://x.com/intent/post?text=${t}&url=${u}`,
      },
      {
        label: "WhatsApp",
        icon: WhatsappIcon,
        href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      },
      {
        label: m.share_email(),
        icon: Mail01Icon,
        href: `mailto:?subject=${t}&body=${u}`,
      },
    ];
  }, [name, url]);

  return (
    <div className="flex items-center gap-2 px-2 pt-0.5">
      <span className="text-muted-foreground mr-auto text-[12px]">
        {m.share_to()}
      </span>
      {targets.map((t) => (
        <Tooltip key={t.label}>
          <TooltipTrigger
            render={
              <a
                aria-label={t.label}
                className={TARGET}
                href={t.href}
                rel="noopener noreferrer"
                target="_blank"
              />
            }
          >
            <Icon className="size-4" icon={t.icon} />
          </TooltipTrigger>
          <TooltipContent>{t.label}</TooltipContent>
        </Tooltip>
      ))}
      <Popover>
        <PopoverTrigger aria-label={m.share_qr()} className={TARGET}>
          <Icon className="size-4" icon={QrCodeIcon} />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-auto items-center gap-3 rounded-[16px] p-3"
          side="top"
          sideOffset={8}
        >
          <QrCode className="size-[160px]" value={url} />
          <span className="text-muted-foreground max-w-[160px] text-center text-[12px]">
            {m.share_qr_hint()}
          </span>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export const ShareDialog = ({
  cvId,
  open,
  onOpenChange,
  share,
  onShare,
}: {
  cvId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  share: ShareState;
  onShare: (next: ShareState) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const preview = usePreview(cvId, open);

  const url = share.shareId ? shareUrl(share.shareId) : null;
  const access: Access = url ? "public" : "private";

  const update = useCallback(
    (patch: { enabled?: boolean; chat?: boolean }) =>
      whileBusy(setBusy, async () => {
        try {
          const next = await setSharing({ id: cvId, ...patch });
          if (patch.enabled === true) {
            track("share_link_created", { chat: next.shareChat });
          } else if (patch.enabled === false) {
            track("share_link_removed");
          }
          onShare(next);
          return next;
        } catch {
          toast.error(m.share_error());
          return null;
        }
      }),
    [cvId, onShare]
  );

  const copy = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(m.share_copy_error());
    }
  }, []);

  const onAccess = useCallback(
    (value: Access | null) => {
      if (value && value !== access) {
        update({ enabled: value === "public" });
      }
    },
    [access, update]
  );

  // Making the link and copying it is one click: that is why people open this.
  const createLink = useCallback(async () => {
    const next = await update({ enabled: true });
    if (next?.shareId) {
      await copy(shareUrl(next.shareId));
    }
  }, [copy, update]);

  const copyLink = useCallback(() => {
    if (url) {
      copy(url);
    }
  }, [copy, url]);

  const toggleChat = useCallback((chat: boolean) => update({ chat }), [update]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-0 rounded-[24px] p-0 sm:max-w-[420px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4">
        <DialogTitle className="px-5 pt-[18px] pr-12 pb-3.5 text-[16px] leading-6 font-semibold tracking-[-0.01em]">
          {m.share_title()}
        </DialogTitle>

        <div className="flex flex-col gap-3 px-3 pb-3">
          <Hero preview={preview} shared={Boolean(url)} />

          {url ? (
            <LinkRow copied={copied} onCopy={copyLink} url={url} />
          ) : (
            <PrivateRow busy={busy} onCreate={createLink} />
          )}

          <div className="ring-foreground/[0.07] flex flex-col rounded-[16px] p-1 ring-1">
            <AccessSelect access={access} disabled={busy} onChange={onAccess} />
            {url ? (
              <>
                <div className="bg-foreground/[0.06] mx-3 my-0.5 h-px" />
                <ChatOption
                  checked={share.shareChat}
                  disabled={busy}
                  empty={preview ? !preview.hasChat : false}
                  onChange={toggleChat}
                />
              </>
            ) : null}
          </div>

          {url ? (
            <ShareTargets name={preview?.cv.basics.name ?? ""} url={url} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
