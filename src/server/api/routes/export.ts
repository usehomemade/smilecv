import { createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";

import { db } from "#/db";
import { cv as cvTable } from "#/db/schema";
import { auth } from "#/lib/auth";
import { PAPER_SIZES, resolveStyle } from "#/lib/cv/engine";
import { normalizeCv } from "#/lib/cv/schema";
import { getTemplate } from "#/lib/cv/templates";
import { getBrowser } from "#/lib/server/browser";
import { signPrintToken } from "#/lib/server/print-token";
import { binary, router } from "#/server/api/lib";

const fileName = (title: string, ext: string) => {
  const base =
    title
      .replaceAll(/[^\p{L}\p{N}_ -]+/gu, "")
      .trim()
      .replaceAll(/\s+/gu, "_") || "CV";
  return `${base}.${ext}`;
};

export const exportCv = router().openapi(
  createRoute({
    method: "get",
    path: "/export/{id}",
    tags: ["CVs"],
    summary: "Download a CV as PDF or PNG",
    description:
      "Owners export their own CVs; anyone may export a CV through its public share link (`share`).",
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        format: z.string().optional().openapi({ example: "pdf" }),
        share: z.string().optional(),
        /** Page breaks as laid out in the editor (JSON). */
        breaks: z.string().optional(),
      }),
    },
    responses: {
      200: binary("application/pdf", "The PDF (or PNG with format=png)"),
      401: { description: "Not signed in" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const request = c.req.raw;
    const params = c.req.valid("param");
    // Owners export their own CVs; anyone may export a CV through its
    // public share link.
    const share = new URL(request.url).searchParams.get("share");
    const session = share
      ? null
      : await auth.api.getSession({ headers: request.headers });
    if (!(share || session)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const [row] = await db
      .select({
        id: cvTable.id,
        title: cvTable.title,
        template: cvTable.template,
        data: cvTable.data,
      })
      .from(cvTable)
      .where(
        and(
          eq(cvTable.id, params.id),
          share
            ? eq(cvTable.shareId, share)
            : eq(cvTable.userId, session?.user.id ?? "")
        )
      );
    if (!row) {
      return new Response("Not found", { status: 404 });
    }

    const format =
      new URL(request.url).searchParams.get("format") === "png" ? "png" : "pdf";
    const port = process.env.PORT || "3033";
    const printParams = new URLSearchParams({
      token: signPrintToken(row.id),
    });
    const breaks = new URL(request.url).searchParams.get("breaks");
    if (breaks && breaks.length < 20_000) {
      printParams.set("breaks", breaks);
    }
    const url = `${process.env.INTERNAL_URL ?? `http://localhost:${port}`}/print/${row.id}?${printParams}`;

    const def = getTemplate(row.template);
    const paper = PAPER_SIZES[resolveStyle(def, normalizeCv(row.data)).paper];
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: paper.width, height: paper.height },
      deviceScaleFactor: format === "png" ? 2 : 1,
    });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      // Pages are laid out in the browser; wait until the paginator is done.
      await page.waitForSelector("[data-cv-ready]", { timeout: 20_000 });

      const body =
        format === "pdf"
          ? await page.pdf({
              width: `${paper.width}px`,
              height: `${paper.height}px`,
              printBackground: true,
              preferCSSPageSize: true,
              margin: { top: "0", bottom: "0", left: "0", right: "0" },
            })
          : await page.locator(".cv-print").screenshot({ type: "png" });
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": format === "pdf" ? "application/pdf" : "image/png",
          "Content-Disposition": `attachment; filename="cv.${format}"; filename*=UTF-8''${encodeURIComponent(fileName(row.title, format))}`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await context.close();
    }
  }
);
