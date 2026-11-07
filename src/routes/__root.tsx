import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  getRouteApi,
} from "@tanstack/react-router";

import { Analytics } from "#/components/analytics";
import { CookieBanner } from "#/components/cookie-banner";
import { ErrorReporter } from "#/components/error-reporter";
import { SignupGate } from "#/components/signup-gate";
import { ErrorPage, NotFoundPage } from "#/components/status-page";
import { Toaster } from "#/components/ui/sonner";
import { TooltipProvider } from "#/components/ui/tooltip";
import { getAnalyticsConfig } from "#/lib/analytics-config";
import { BRAND } from "#/lib/brand";
import { textDirection } from "#/lib/i18n";
import { THEME_SCRIPT } from "#/lib/theme";
import { m } from "#/paraglide/messages.js";
import { getLocale } from "#/paraglide/runtime.js";

import appCss from "../styles.css?url";

const routeApi = getRouteApi("__root__");

/** The UI font, fetched with the HTML so text never swaps fonts after load. */
const PRELOAD_FONTS = [inter400, inter500, inter600].map((href) => ({
  rel: "preload",
  href,
  as: "font",
  type: "font/woff2",
  crossOrigin: "anonymous" as const,
}));

interface MyRouterContext {
  queryClient: QueryClient;
}

const RootDocument = ({ children }: { children: React.ReactNode }) => {
  const locale = getLocale();
  const analytics = routeApi.useLoaderData();
  return (
    <html dir={textDirection(locale)} lang={locale} suppressHydrationWarning>
      <head>
        {/* oxlint-disable-next-line react/no-danger -- static, first-party theme bootstrap; prevents a flash of the wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-center" />
        <SignupGate />
        <CookieBanner />
        <ErrorReporter />
        <Analytics config={analytics ?? null} />
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRouteWithContext<MyRouterContext>()({
  // Umami settings: read once on the server, then kept for the visit.
  loader: () => getAnalyticsConfig(),
  staleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "build", content: __BUILD_ID__ },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: m.meta_title() },
      { name: "description", content: m.meta_description() },
    ],
    links: [
      ...PRELOAD_FONTS,
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: BRAND.favicon32, type: "image/png", sizes: "32x32" },
      { rel: "icon", href: BRAND.favicon64, type: "image/png", sizes: "64x64" },
      { rel: "apple-touch-icon", href: BRAND.appleTouchIcon },
    ],
  }),
  shellComponent: RootDocument,
  // Unknown URLs and every `throw notFound()` (bad share links, someone
  // else's CV) get the styled page with the normal header and footer.
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});
