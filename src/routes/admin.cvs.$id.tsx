import { Download01Icon } from "@hugeicons-pro/core-stroke-rounded";
import {
  createFileRoute,
  Link,
  notFound,
  getRouteApi,
} from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fmtAgo,
  fmtBytes,
  fmtDate,
  fmtUsd,
  PageTitle,
  Panel,
  Tag,
} from "#/components/admin/ui";
import { PagedCv } from "#/components/cv/paged";
import { ChatMessage } from "#/components/editor/chat/thread";
import { Icon } from "#/components/icon";
import { getAdminCv } from "#/lib/admin/functions";
import { PAPER_SIZES, resolveStyle } from "#/lib/cv/engine";
import type { CV } from "#/lib/cv/schema";
import { getTemplate } from "#/lib/cv/templates";
import { LinksDisabled } from "#/lib/cv/templates/shared";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages.js";

const routeApi = getRouteApi("/admin/cvs/$id");

const Pages = ({ cv, template }: { cv: CV; template: string }) => {
  const def = getTemplate(template);
  const paper = PAPER_SIZES[resolveStyle(def, cv).paper];
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
  return (
    <div
      className="relative mx-auto w-full"
      ref={box}
      style={{ maxWidth: paper.width, height: height * (scale || 1) }}
    >
      <div
        className={cn(
          "absolute top-0 left-0 origin-top-left transition-opacity duration-300",
          ready && scale > 0 ? "opacity-100" : "opacity-0"
        )}
        ref={inner}
        style={{ width: paper.width, transform: `scale(${scale || 1})` }}
      >
        <div className="flex flex-col gap-6 [&_.cv-sheet]:shadow-[0_1px_3px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.08)]">
          <LinksDisabled.Provider value>
            <PagedCv cv={cv} def={def} onReady={onReady} />
          </LinksDisabled.Provider>
        </div>
      </div>
    </div>
  );
};

const AdminCv = () => {
  const cv = routeApi.useLoaderData();
  const messages = JSON.parse(cv.chatJson) as UIMessage[];
  return (
    <>
      <Link
        className="text-muted-foreground hover:text-foreground mb-3 inline-block text-[13px]"
        params={{ id: cv.userId }}
        to="/admin/users/$id"
      >
        {m.admin_back_owner({
          name: cv.owner.isAnonymous
            ? m.admin_guest()
            : cv.owner.name || cv.owner.email,
        })}
      </Link>
      <PageTitle
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {m.admin_cv_desc({
                template: cv.template,
                created: fmtDate(cv.createdAt),
                updated: fmtAgo(cv.updatedAt),
              })}
            </span>
            {cv.shareId ? <Tag tone="good">{m.admin_shared()}</Tag> : null}
            <Tag>{m.admin_read_only()}</Tag>
          </span>
        }
        title={cv.title}
      >
        {cv.shareId ? (
          <a
            className="text-muted-foreground hover:text-foreground text-[13px] underline underline-offset-2"
            href={`/s/${cv.shareId}`}
            rel="noopener"
            target="_blank"
          >
            {m.admin_open_share()}
          </a>
        ) : null}
      </PageTitle>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Pages cv={cv.data} template={cv.template} />
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={m.admin_chat_title({
              count: messages.length,
              cost: fmtUsd(cv.usage.cost),
            })}
          >
            {messages.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-[13px]">
                {m.admin_empty()}
              </p>
            ) : (
              <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto p-4">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} streaming={false} />
                ))}
              </div>
            )}
          </Panel>
          <Panel title={m.admin_files_title({ count: cv.files.length })}>
            {cv.files.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-[13px]">
                {m.admin_empty()}
              </p>
            ) : (
              <ul className="divide-y">
                {cv.files.map((f) => (
                  <li
                    className="flex items-center gap-3 px-4 py-2.5"
                    key={f.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px]">
                        {f.name}
                      </span>
                      <span className="text-muted-foreground block text-[12px]">
                        {`${f.mediaType} · ${fmtBytes(f.size)}`}
                      </span>
                    </span>
                    <a
                      aria-label={m.admin_download()}
                      className="text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground rounded-full p-1.5"
                      href={`/api/admin/files/${f.id}`}
                    >
                      <Icon className="size-4" icon={Download01Icon} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
};

export const Route = createFileRoute("/admin/cvs/$id")({
  loader: async ({ params }) => {
    const cv = await getAdminCv({ id: params.id });
    if (!cv) {
      throw notFound();
    }
    return cv;
  },
  component: AdminCv,
});
