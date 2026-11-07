import {
  ArrowRight02Icon,
  ArrowUp02Icon,
  Download01Icon,
  LoaderCircleIcon,
} from "@hugeicons-pro/core-stroke-rounded";
import {
  createFileRoute,
  Link,
  notFound,
  getRouteApi,
} from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PagedCv } from "#/components/cv/paged";
import { ChatMessage } from "#/components/editor/chat/thread";
import { Icon } from "#/components/icon";
import { CvThumb, Logo } from "#/components/primitives";
import { SiteFooter } from "#/components/site-footer";
import { Button } from "#/components/ui/button";
import { BRAND } from "#/lib/brand";
import { PAPER_SIZES, resolveStyle } from "#/lib/cv/engine";
import { sampleCv } from "#/lib/cv/sample";
import { getSharedCv } from "#/lib/cv/share";
import { getTemplate } from "#/lib/cv/templates";
import { track } from "#/lib/track";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages.js";
import { getLocale } from "#/paraglide/runtime.js";

const routeApi = getRouteApi("/s/$shareId");

/** The gap between sheets (gap-6). */
const PAGE_GAP = 24;

const ScaledPages = ({
  shared,
}: {
  shared: ReturnType<typeof Route.useLoaderData>;
}) => {
  const def = getTemplate(shared.template);
  const paper = PAPER_SIZES[resolveStyle(def, shared.data).paper];
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [height, setHeight] = useState(paper.height);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!(b && i)) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, b.clientWidth / paper.width));
      setHeight(i.offsetHeight);
    });
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  }, [paper.width]);

  const shown = ready && scale > 0;
  // All pages plus the gaps between them, as the editor last laid them out.
  const reserved = shared.pages * paper.height + (shared.pages - 1) * PAGE_GAP;
  return (
    // Until the pages are laid out, the box holds one blank sheet at the
    // page's aspect ratio (rendered on the server too), so nothing below it
    // moves when the CV appears.
    <div
      className="relative w-full"
      ref={box}
      style={
        shown
          ? { maxWidth: paper.width, height: height * scale }
          : {
              maxWidth: paper.width,
              aspectRatio: `${paper.width} / ${reserved}`,
            }
      }
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.08)] transition-opacity duration-300",
          shown ? "opacity-0" : "opacity-100"
        )}
        style={{ aspectRatio: `${paper.width} / ${paper.height}` }}
      />
      <div
        className={cn(
          "absolute top-0 left-0 origin-top-left transition-opacity duration-300 ease-out",
          shown ? "opacity-100" : "opacity-0"
        )}
        ref={inner}
        style={{ width: paper.width, transform: `scale(${scale || 1})` }}
      >
        <div className="flex flex-col gap-6 [&_.cv-sheet]:shadow-[0_1px_3px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.08)]">
          <PagedCv cv={shared.data} def={def} onReady={onReady} />
        </div>
      </div>
    </div>
  );
};

/** Downloads the shared CV as a PDF; shows a toast when it fails. */
const downloadSharedPdf = async (id: string, name: string, shareId: string) => {
  try {
    const res = await fetch(
      `/api/export/${id}?format=pdf&share=${encodeURIComponent(shareId)}`
    );
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replaceAll(/[\\/:*?"<>|]+/gu, "") || "CV"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    track("share_pdf_downloaded");
  } catch {
    toast.error(m.shared_pdf_error());
  }
};

const DownloadButton = ({
  id,
  name,
  shareId,
}: {
  id: string;
  name: string;
  shareId: string;
}) => {
  const [busy, setBusy] = useState(false);
  const download = useCallback(async () => {
    setBusy(true);
    await downloadSharedPdf(id, name, shareId);
    setBusy(false);
  }, [id, name, shareId]);
  return (
    <Button
      aria-label={m.shared_pdf_label()}
      disabled={busy}
      onClick={download}
      variant="outline"
    >
      <Icon
        className={busy ? "animate-spin" : undefined}
        data-icon="inline-start"
        icon={busy ? LoaderCircleIcon : Download01Icon}
      />
      {m.shared_pdf()}
    </Button>
  );
};

const FAN = [
  { template: "modern", x: -64, y: 16, r: -7, z: 1 },
  { template: "studio", x: 64, y: 16, r: 7, z: 1 },
  { template: "classic", x: 0, y: 0, r: 0, z: 2 },
];

const PromoVisual = () => {
  const sample = useMemo(() => sampleCv(), []);
  return (
    <div
      aria-hidden
      className="relative m-2 mb-0 h-[200px] overflow-hidden rounded-[20px] bg-[radial-gradient(120%_100%_at_50%_0%,var(--surface-2),var(--surface)_70%)]"
    >
      {/* Sheets fade out at the bottom instead of being cut off mid-page. */}
      <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_55%,transparent_96%)]">
        {FAN.map((f) => (
          <div
            className={cn(
              "absolute top-6 left-1/2 -ml-[56px] w-[112px] overflow-hidden rounded-[5px] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_28px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] [backface-visibility:hidden]",
              f.z === 1 && "opacity-80"
            )}
            key={f.template}
            style={{
              zIndex: f.z,
              transform: `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.r}deg)`,
            }}
          >
            <CvThumb cv={sample} template={f.template} />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center">
        {/* Corner radius = the logo squircle's (~6px) + the 4px inset. */}
        <div className="bg-background ring-foreground/[0.06] flex min-w-0 items-center gap-2 rounded-[10px] p-1 text-[12px] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_24px_-4px_rgba(0,0,0,0.16)] ring-1">
          <img
            alt=""
            className="size-6 shrink-0"
            height={24}
            src={BRAND.logo}
            width={24}
          />
          <span className="truncate font-medium">
            {m.shared_promo_prompt()}
          </span>
          <span
            aria-hidden
            className="bg-foreground text-background flex size-6 shrink-0 items-center justify-center rounded-[6px]"
          >
            <Icon className="size-3.5" icon={ArrowUp02Icon} strokeWidth={2} />
          </span>
        </div>
      </div>
    </div>
  );
};

/** Clicks on "make your own" links, by where they sit on the page. */
const handleHeaderCtaClick = () =>
  track("share_cta_click", { where: "header" });
const handlePromoCtaClick = () => track("share_cta_click", { where: "promo" });
const handleMobileCtaClick = () =>
  track("share_cta_click", { where: "mobile" });

const Promo = () => (
  <div className="group/promo bg-background ring-foreground/[0.06] overflow-hidden rounded-[28px] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_48px_-16px_rgba(0,0,0,0.14)] ring-1">
    <PromoVisual />
    <div className="flex flex-col gap-5 p-6 pt-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-balance">
          {m.shared_promo_title()}
        </h2>
        <p className="text-muted-foreground text-[14px] leading-relaxed text-pretty">
          {m.shared_promo_body({ brand: BRAND.name })}
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button
          className="w-full"
          nativeButton={false}
          onClick={handlePromoCtaClick}
          render={<Link to="/" />}
          size="lg"
        >
          {m.shared_promo_cta()}
          <Icon
            className="transition-transform duration-200 ease-out group-hover/promo:translate-x-0.5"
            data-icon="inline-end"
            icon={ArrowRight02Icon}
          />
        </Button>
        <p className="text-muted-foreground text-center text-[12px]">
          {m.shared_promo_note()}
        </p>
      </div>
    </div>
  </div>
);

const MobilePromo = ({ hidden }: { hidden: boolean }) => (
  <div
    className={cn(
      "fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 transition-[opacity,transform] duration-300 ease-out lg:hidden",
      hidden ? "pointer-events-none translate-y-3 opacity-0" : "opacity-100"
    )}
  >
    <Link
      className="bg-foreground text-background flex h-12 items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 text-[14px] shadow-[0_4px_8px_rgba(0,0,0,0.08),0_16px_40px_-8px_rgba(0,0,0,0.35)] active:scale-[0.98]"
      onClick={handleMobileCtaClick}
      tabIndex={hidden ? -1 : undefined}
      to="/"
    >
      <img
        alt=""
        className="bg-background size-9 rounded-full p-1"
        height={36}
        src={BRAND.logo}
        width={36}
      />
      <span className="flex flex-col leading-tight">
        <span className="text-background/60 text-[11px]">
          {m.shared_made_with({ brand: BRAND.name })}
        </span>
        <span className="font-medium">{m.shared_mobile_cta()}</span>
      </span>
      <Icon className="ml-1 size-4" icon={ArrowRight02Icon} />
    </Link>
  </div>
);

const useInView = (ref: React.RefObject<HTMLElement | null>) => {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      threshold: 0.2,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const HowItWasMade = ({ messages }: { messages: UIMessage[] }) => (
  <section className="flex w-full max-w-[680px] flex-col gap-5">
    <div className="flex flex-col gap-1">
      <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
        {m.shared_how_title()}
      </h2>
      <p className="text-muted-foreground text-[14px]">{m.shared_how_body()}</p>
    </div>
    <div className="bg-background ring-foreground/[0.06] flex flex-col gap-6 rounded-[24px] p-5 ring-1">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} streaming={false} />
      ))}
    </div>
  </section>
);

const SharedPage = () => {
  const shared = routeApi.useLoaderData();
  const { shareId } = routeApi.useParams();
  const messages = JSON.parse(shared.chatJson) as UIMessage[];
  const name = shared.data.basics.name || shared.title;

  const updated = formatDate(shared.updatedAt);
  const promo = useRef<HTMLDivElement>(null);
  const promoVisible = useInView(promo);

  return (
    <div className="bg-surface min-h-dvh">
      <header className="bg-background/85 sticky top-0 z-20 shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_7%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4">
          <Link
            aria-label={m.shared_home_label({ brand: BRAND.name })}
            className="flex shrink-0 items-center"
            to="/"
          >
            <Logo />
          </Link>
          <span className="bg-foreground/15 hidden h-4 w-px sm:block" />
          <span className="text-muted-foreground hidden min-w-0 truncate text-[15px] leading-none sm:block">
            {name}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DownloadButton id={shared.id} name={name} shareId={shareId} />
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              onClick={handleHeaderCtaClick}
              render={<Link to="/" />}
            >
              {m.shared_make_own()}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1200px] gap-10 px-4 pt-8 pb-28 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:py-10">
        <div className="flex min-w-0 flex-col items-center gap-10">
          <div className="flex w-full flex-col items-center gap-4">
            <ScaledPages shared={shared} />
            <p className="text-muted-foreground text-[12px]">
              {m.shared_updated({ date: updated })}
            </p>
          </div>
          {messages.length > 0 ? <HowItWasMade messages={messages} /> : null}
        </div>
        <aside
          className="mx-auto w-full max-w-[400px] lg:sticky lg:top-24 lg:max-w-none lg:self-start"
          ref={promo}
        >
          <Promo />
        </aside>
      </main>
      <SiteFooter />
      <MobilePromo hidden={promoVisible} />
    </div>
  );
};

export const Route = createFileRoute("/s/$shareId")({
  loader: async ({ params }) => {
    const cv = await getSharedCv({ shareId: params.shareId });
    if (!cv) {
      throw notFound();
    }
    return cv;
  },
  head: ({ loaderData }) => {
    const name =
      loaderData?.data.basics.name || loaderData?.title || m.shared_cv();
    const headline = loaderData?.data.basics.headline ?? "";
    return {
      meta: [
        { title: m.shared_meta_title({ name }) },
        {
          name: "description",
          content: headline || m.share_text_named({ name }),
        },
        { property: "og:title", content: m.shared_meta_title({ name }) },
        { property: "og:description", content: headline },
        // A personal page: reachable by link only, kept out of search.
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: SharedPage,
});
