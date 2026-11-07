import {
  ArrowLeft02Icon,
  CloudOffIcon,
  CloudSavingDone01Icon,
  CloudUploadIcon,
  Download01Icon,
  File02Icon,
  Image01Icon,
  LoaderCircleIcon,
  Redo03Icon,
  Share08Icon,
  Undo03Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  getRouteApi,
} from "@tanstack/react-router";
import type { FileUIPart, UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Canvas } from "#/components/editor/canvas";
import { ChatPanel } from "#/components/editor/chat";
import type { ChatContext } from "#/components/editor/chat";
import { ChatDock, DOCK_GAP, useDock } from "#/components/editor/chat-dock";
import type { ClipResult } from "#/components/editor/clip";
import { HistoryPanel } from "#/components/editor/history-panel";
import { ShareDialog } from "#/components/editor/share-dialog";
import type { ShareState } from "#/components/editor/share-dialog";
import { StyleBar } from "#/components/editor/style-bar";
import { useHistory } from "#/components/editor/use-history";
import type { Doc } from "#/components/editor/use-history";
import { Icon } from "#/components/icon";
import type { IconSvgElement } from "#/components/icon";
import { AccountArea } from "#/components/site-header";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import type { PageBreaks } from "#/lib/cv/engine";
import { getCv, getViewer, updateCv } from "#/lib/cv/functions";
import { removeAt, splitIndex } from "#/lib/cv/paths";
import type { Path } from "#/lib/cv/paths";
import { newId } from "#/lib/cv/schema";
import type { CV } from "#/lib/cv/schema";
import { getTemplate } from "#/lib/cv/templates";
import type { TemplateId } from "#/lib/cv/templates";
import { listVersions } from "#/lib/cv/versions";
import { getDockPrefs } from "#/lib/dock-prefs";
import { ENGLISH_NAMES } from "#/lib/i18n";
import { track, trackOnce } from "#/lib/track";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages.js";
import type { Locale } from "#/paraglide/runtime.js";
import { getLocale } from "#/paraglide/runtime.js";

const routeApi = getRouteApi("/cv/$id");

/** Only our own stored files can be handed to the editor to import. */
const IMPORT_URL = /^\/api\/files\/[\w-]+(?:\?size=\d+)?$/u;

type SaveState = "saved" | "saving" | "dirty" | "error";

type Panel = "chat" | "cv";

const FILE_UNSAFE = /[\\/:*?"<>|]+/gu;

const isFormControl = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(
    el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT")
  );
};

const isCvField = (target: EventTarget | null) =>
  Boolean((target as HTMLElement | null)?.isContentEditable);

const MobileSwitch = ({
  panel,
  onChange,
  className,
}: {
  panel: "chat" | "cv";
  onChange: (panel: "chat" | "cv") => void;
  className?: string;
}) => {
  const chat = useCallback(() => onChange("chat"), [onChange]);
  const cv = useCallback(() => onChange("cv"), [onChange]);
  return (
    <div
      aria-label={m.ed_show()}
      className={cn(
        "bg-surface flex h-9 shrink-0 rounded-full p-0.5",
        className
      )}
      role="tablist"
    >
      {(
        [
          ["chat", m.ed_chat(), chat],
          ["cv", m.ed_cv(), cv],
        ] as const
      ).map(([id, label, pick]) => (
        <button
          aria-selected={panel === id}
          className={cn(
            "h-8 cursor-pointer rounded-full px-3.5 text-[13px] font-medium transition-colors",
            panel === id
              ? "bg-background ring-foreground/[0.06] shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1"
              : "text-muted-foreground"
          )}
          key={id}
          onClick={pick}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
};

const Kbd = ({ children }: { children: string }) => (
  <span className="ml-1.5 opacity-60">{children}</span>
);

const HeaderButton = ({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
}: {
  icon: IconSvgElement;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon"
          variant="ghost"
        />
      }
    >
      <Icon icon={icon} />
    </TooltipTrigger>
    <TooltipContent>
      {label}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </TooltipContent>
  </Tooltip>
);

const SAVE_ICONS = {
  saved: CloudSavingDone01Icon,
  busy: CloudUploadIcon,
  error: CloudOffIcon,
};

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

const SaveIndicator = ({
  state,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  savedAt: number | null;
  onRetry: () => void;
}) => {
  const busy = state === "saving" || state === "dirty";
  let label = savedAt
    ? m.ed_all_saved_at({
        time: new Date(savedAt).toLocaleTimeString(getLocale(), TIME_OPTIONS),
      })
    : m.ed_all_saved();
  if (busy) {
    label = m.ed_saving();
  } else if (state === "error") {
    label = m.ed_save_failed();
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            aria-live="polite"
            className={cn(
              "relative grid size-8 shrink-0 place-items-center rounded-full transition-colors",
              state === "error"
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground/70 pointer-events-auto cursor-default"
            )}
            onClick={state === "error" ? onRetry : undefined}
            type="button"
          />
        }
      >
        {(["saved", "busy", "error"] as const).map((k) => (
          <Icon
            aria-hidden
            className={cn(
              "col-start-1 row-start-1 size-[18px] transition-[opacity,transform] duration-200 ease-out",
              (k === "busy" ? busy : state === k)
                ? "scale-100 opacity-100"
                : "scale-90 opacity-0"
            )}
            icon={SAVE_ICONS[k]}
            key={k}
          />
        ))}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

const languageName = (target: Locale) => {
  const ui = getLocale();
  const name = new Intl.DisplayNames([ui], { type: "language" }).of(target);
  return name
    ? name.charAt(0).toLocaleUpperCase(ui) + name.slice(1)
    : ENGLISH_NAMES[target];
};

const wait = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form in the browser
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Exports the CV as a file download; toasts on failure. Never throws. */
const exportCv = async ({
  format,
  id,
  title,
  flush,
  breaks,
}: {
  format: "pdf" | "png";
  id: string;
  title: string;
  flush: () => Promise<void>;
  breaks: RefObject<PageBreaks | null>;
}) => {
  try {
    // Lets the editor re-render and lay out pages without the selection.
    await wait(120);
    await flush();
    const params = new URLSearchParams({ format });
    if (breaks.current) {
      params.set("breaks", JSON.stringify(breaks.current));
    }
    const res = await fetch(`/api/export/${id}?${params}`);
    if (!res.ok) {
      throw new Error(m.ed_export_failed({ status: res.status }));
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title.trim() || m.ed_cv()).replaceAll(FILE_UNSAFE, "")}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
    track("export", { format });
  } catch (error) {
    track("export", { format, ok: false });
    toast.error((error as Error).message);
  }
};

const Editor = () => {
  const {
    viewer,
    cv: initial,
    dock: loaderDock,
    history: stored,
  } = routeApi.useLoaderData();
  const history = useHistory(
    initial.id,
    { cv: initial.data, template: initial.template as TemplateId },
    stored.versions,
    stored.more
  );
  const { doc, commit, undo, redo, jump, loadOlder } = history;
  const def = getTemplate(doc.template);
  const [title, setTitle] = useState(initial.title);
  const [panel, setPanel] = useState<Panel>("cv");
  const dock = useDock(loaderDock);
  const updateDock = dock.update;
  const area = useRef<HTMLDivElement>(null);
  // Space the floating chat card covers, so the canvas centres in what's left.
  const reserve = {
    side: dock.side,
    px: dock.minimized ? 0 : dock.width + DOCK_GAP * 2,
  };
  const [share, setShare] = useState<ShareState>({
    shareId: initial.shareId,
    shareChat: initial.shareChat,
  });
  const [sharing, setSharing] = useState(false);
  const openShare = useCallback(() => setSharing(true), []);
  const [save, setSave] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "png" | null>(null);
  const [selected, setSelected] = useState<Path | null>(null);
  const [clipping, setClipping] = useState(false);
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [focusKey, setFocusKey] = useState(0);

  const latest = useRef({ doc, title });
  const breaksRef = useRef<PageBreaks | null>(null);
  // The share page reserves this many pages before laying the CV out, so
  // keep the stored count in step with the editor's layout.
  const savedPages = useRef(initial.pages);
  const onBreaks = useCallback(
    (b: PageBreaks) => {
      breaksRef.current = b;
      const pages = Math.max(b.main.length, b.side.length) + 1;
      if (pages !== savedPages.current) {
        savedPages.current = pages;
        updateCv({ id: initial.id, pages }).catch(() => {
          savedPages.current = 0;
        });
      }
    },
    [initial.id]
  );
  useLayoutEffect(() => {
    latest.current = { doc, title };
  }, [doc, title]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef({ doc, title });

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = null;
    setSave("saving");
    try {
      const { current } = latest;
      await updateCv({
        id: initial.id,
        data: current.doc.cv,
        template: current.doc.template,
        pages: breaksRef.current
          ? Math.max(
              breaksRef.current.main.length,
              breaksRef.current.side.length
            ) + 1
          : undefined,
        title: current.title.trim() || m.cv_untitled(),
      });
      setSave("saved");
      setSavedAt(Date.now());
    } catch {
      setSave("error");
    }
  }, [initial.id]);

  // Autosave shortly after the last change.
  useEffect(() => {
    const prev = previous.current;
    if (prev.doc === doc && prev.title === title) {
      return;
    }
    previous.current = { doc, title };
    setSave("dirty");
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(flush, 700);
  }, [doc, title, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const changeCv = useCallback(
    (update: (cv: CV) => CV) =>
      commit((d) => {
        const cv = update(d.cv);
        if (cv !== d.cv) {
          trackOnce(`edit:${initial.id}`, "first_edit", { how: "inline" });
        }
        return cv === d.cv ? d : { ...d, cv };
      }),
    [commit, initial.id]
  );
  const setTemplate = useCallback(
    (template: string) =>
      commit((d) => {
        if (d.template !== template) {
          track("template_switched", { from: d.template, to: template });
        }
        return { ...d, template };
      }),
    [commit]
  );
  const undoButton = useCallback(() => {
    track("undo", { how: "button" });
    undo();
  }, [undo]);
  const redoButton = useCallback(() => {
    track("redo", { how: "button" });
    redo();
  }, [redo]);
  const jumpTo = useCallback(
    (...args: Parameters<typeof jump>) => {
      track("history_jump");
      return jump(...args);
    },
    [jump]
  );

  // Keyboard: undo/redo, delete the selected item, Esc to deselect.
  useEffect(() => {
    // oxlint-disable-next-line complexity -- a flat key map
    const onKey = (e: KeyboardEvent) => {
      if (isFormControl(e.target)) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Undo/redo also inside CV fields: the browser's own undo doesn't know
      // about the editor's state and would desync the field.
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) {
          track("redo", { how: "key" });
          redo();
        } else {
          track("undo", { how: "key" });
          undo();
        }
        return;
      }
      if (isCvField(e.target)) {
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        const loc = splitIndex(selected);
        if (loc) {
          e.preventDefault();
          changeCv((c) => removeAt(c, loc.list, loc.index));
          setSelected(null);
        }
      }
    };
    // Edit-menu undo or touch-bar undo inside a field arrives as beforeinput.
    const onBeforeInput = (e: InputEvent) => {
      if (!isCvField(e.target)) {
        return;
      }
      if (e.inputType === "historyUndo") {
        e.preventDefault();
        undo();
      } else if (e.inputType === "historyRedo") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("beforeinput", onBeforeInput);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeinput", onBeforeInput);
    };
  }, [undo, redo, selected, changeCv]);

  const download = useCallback(
    async (format: "pdf" | "png") => {
      setExporting(format);
      // Page breaks are taken from the editor, without the selection's
      // temporary empty-field placeholders.
      setSelected(null);
      await exportCv({
        format,
        id: initial.id,
        title,
        flush,
        breaks: breaksRef,
      });
      setExporting(null);
    },
    [flush, initial.id, title]
  );
  const downloadPdf = useCallback(() => download("pdf"), [download]);
  const downloadPng = useCallback(() => download("png"), [download]);
  const handleTitle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
    []
  );
  const getState = useCallback(
    () => ({
      cv: latest.current.doc.cv,
      template: latest.current.doc.template,
    }),
    []
  );
  // Everything the AI changes during one reply is one step in the history.
  const aiTurn = useRef<{ id: string; label: string }>({ id: "", label: "" });
  const onAiTurn = useCallback((prompt: string) => {
    const words = prompt.trim().replaceAll(/\s+/gu, " ");
    aiTurn.current = {
      id: newId(),
      // The history panel marks AI versions with an icon and quotes the ask.
      label: words.length > 48 ? `${words.slice(0, 47)}…` : words,
    };
  }, []);
  const applyRemote = useCallback(
    (next: Doc) =>
      commit(() => next, {
        label: aiTurn.current.label || m.ed_ai_edit(),
        group: `ai:${aiTurn.current.id}`,
        source: "ai",
      }),
    [commit]
  );

  const addContext = useCallback((c: Omit<ChatContext, "id">) => {
    setContexts((list) => [...list, { ...c, id: newId() }]);
    setPanel("chat");
    setFocusKey((k) => k + 1);
  }, []);
  // A quick action ("Shorten", …) sends straight away; plain "Ask AI" just
  // attaches the part and lets the user type.
  const [pendingPrompt, setPendingPrompt] = useState<{
    id: string;
    text: string;
    files?: FileUIPart[];
  } | null>(null);
  // Arrived from "Import a CV": send the file to the AI once, then drop the
  // search params so a reload doesn't send it again.
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  // Adjusted while rendering (not in an effect), once per new import.
  const [seenImport, setSeenImport] = useState<string>();
  if (search.import !== seenImport) {
    setSeenImport(search.import);
    if (search.import) {
      setPendingPrompt({
        id: `import:${search.import}`,
        text: m.chat_start_import_prompt(),
        files: [
          {
            type: "file",
            url: search.import,
            filename: search.name || "CV",
            mediaType: search.type || "application/pdf",
          },
        ],
      });
      setPanel("chat");
    }
  }
  useEffect(() => {
    if (search.import) {
      navigate({ search: {}, replace: true });
    }
  }, [search.import, navigate]);
  const onAsk = useCallback(
    (path: Path, label: string, text: string, prompt?: string) => {
      addContext({ label, fields: [{ path, text }] });
      if (prompt) {
        setPendingPrompt({ id: newId(), text: prompt });
      }
    },
    [addContext]
  );
  const clearPendingPrompt = useCallback(() => setPendingPrompt(null), []);
  // "CV language" → translate everything: the AI does it in the chat, so
  // it shows up there and lands as one step in the history.
  const onTranslate = useCallback((locale: Locale) => {
    setPendingPrompt({
      id: newId(),
      text: m.ed_translate_prompt({ language: languageName(locale) }),
    });
    setPanel("chat");
  }, []);
  const onClip = useCallback(
    (clip: ClipResult | null) => {
      setClipping(false);
      if (clip && (clip.image || clip.fields.length > 0)) {
        addContext({
          label: m.ed_clipped_area(),
          fields: clip.fields,
          image: clip.image,
        });
      }
    },
    [addContext]
  );
  const removeContext = useCallback(
    (id: string) => setContexts((list) => list.filter((c) => c.id !== id)),
    []
  );
  const clearContexts = useCallback(() => setContexts([]), []);
  const toggleClip = useCallback(() => {
    setSelected(null);
    setClipping((c) => !c);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-2 sm:h-14 sm:gap-2 sm:px-3">
        <Button
          aria-label={m.ed_back_to_cvs()}
          nativeButton={false}
          render={<Link to="/cvs" />}
          size="icon"
          variant="ghost"
        >
          <Icon icon={ArrowLeft02Icon} />
        </Button>
        <SaveIndicator onRetry={flush} savedAt={savedAt} state={save} />
        <input
          aria-label={m.ed_cv_name()}
          className="hover:bg-surface focus:bg-surface h-9 w-full min-w-0 flex-1 rounded-lg bg-transparent px-2 text-[15px] font-medium outline-none sm:w-72 sm:flex-none"
          onChange={handleTitle}
          value={title}
        />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="hidden items-center sm:flex">
            <HeaderButton
              disabled={!history.canUndo}
              icon={Undo03Icon}
              label={m.ed_undo()}
              onClick={undoButton}
              shortcut="⌘Z"
            />
            <HeaderButton
              disabled={!history.canRedo}
              icon={Redo03Icon}
              label={m.ed_redo()}
              onClick={redoButton}
              shortcut="⇧⌘Z"
            />
          </div>
          <HeaderButton
            icon={Share08Icon}
            label={m.ed_share()}
            onClick={openShare}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button disabled={!!exporting}>
                  {exporting ? (
                    <Icon
                      className="animate-spin"
                      data-icon="inline-start"
                      icon={LoaderCircleIcon}
                    />
                  ) : (
                    <Icon data-icon="inline-start" icon={Download01Icon} />
                  )}
                  {exporting ? m.ed_preparing() : m.ed_download()}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={downloadPdf}>
                <Icon icon={File02Icon} /> {m.ed_pdf()}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadPng}>
                <Icon icon={Image01Icon} /> {m.ed_png_image()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {viewer.isAnonymous ? (
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              render={<Link to="/signup" />}
              variant="outline"
            >
              {m.guest_sign_up()}
            </Button>
          ) : (
            <AccountArea viewer={viewer} />
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {panel === "chat" ? (
          <div className="flex shrink-0 border-b px-3 py-2 lg:hidden">
            <MobileSwitch onChange={setPanel} panel={panel} />
          </div>
        ) : null}
        <div className={cn("lg:block", panel === "cv" ? "block" : "hidden")}>
          <StyleBar
            clipping={clipping}
            cv={doc.cv}
            def={def}
            onChange={changeCv}
            onSelect={setSelected}
            onTemplate={setTemplate}
            onToggleClip={toggleClip}
            onTranslate={onTranslate}
            start={
              <MobileSwitch
                className="lg:hidden"
                onChange={setPanel}
                panel={panel}
              />
            }
            template={def.id}
          />
        </div>
        <div className="relative flex min-h-0 flex-1" ref={area}>
          <ChatDock
            area={area}
            minimized={dock.minimized}
            onUpdate={updateDock}
            side={dock.side}
            visible={panel === "chat"}
            width={dock.width}
          >
            <ChatPanel
              contexts={contexts}
              cvId={initial.id}
              focusKey={focusKey}
              getState={getState}
              guestAiLeft={viewer.guestAiLeft}
              history={
                <HistoryPanel
                  cursor={history.cursor}
                  hasOlder={history.hasOlder}
                  onJump={jumpTo}
                  onLoadOlder={loadOlder}
                  versions={history.versions}
                />
              }
              initialMessages={JSON.parse(initial.chatJson) as UIMessage[]}
              limitKind={viewer.limitKind}
              onAiTurn={onAiTurn}
              onClearContexts={clearContexts}
              onPendingPromptSent={clearPendingPrompt}
              onRemoteChange={applyRemote}
              onRemoveContext={removeContext}
              onShare={openShare}
              pendingPrompt={pendingPrompt}
              title={title}
            />
          </ChatDock>
          <main
            className={cn(
              "min-w-0 flex-1 lg:block",
              panel === "cv" ? "block" : "hidden"
            )}
          >
            <Canvas
              clipping={clipping}
              cv={doc.cv}
              def={def}
              onAsk={onAsk}
              onBreaks={onBreaks}
              onChange={changeCv}
              onClip={onClip}
              onSelect={setSelected}
              reserve={reserve}
              selected={selected}
            />
          </main>
        </div>
      </div>
      <ShareDialog
        cvId={initial.id}
        onOpenChange={setSharing}
        onShare={setShare}
        open={sharing}
        share={share}
      />
    </div>
  );
};

export const Route = createFileRoute("/cv/$id")({
  /** `import` (+ name, type): a file just uploaded from "Import a CV", sent to the AI once. */
  validateSearch: z.object({
    import: z.string().regex(IMPORT_URL).optional().catch(undefined),
    name: z.string().max(200).optional().catch(undefined),
    type: z.string().max(100).optional().catch(undefined),
  }),
  loader: async ({ params }) => {
    const viewer = await getViewer();
    if (!viewer) {
      throw redirect({ to: "/" });
    }
    const [cv, dock] = await Promise.all([
      getCv({ id: params.id }),
      getDockPrefs(),
    ]);
    if (!cv) {
      throw notFound();
    }
    const history = await listVersions({ cvId: params.id });
    return { viewer, cv, dock, history };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: m.ed_meta_title({ title: loaderData?.cv.title ?? m.ed_cv() }) },
    ],
  }),
  component: Editor,
});
