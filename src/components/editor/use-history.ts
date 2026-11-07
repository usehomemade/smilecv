import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useState,
} from "react";

import {
  changedPaths,
  createTimeline,
  editGroup,
  timelineReducer,
} from "#/lib/cv/history";
import type {
  CommitMeta,
  Timeline,
  TimelineAction,
  Version,
} from "#/lib/cv/history";
import { newId } from "#/lib/cv/schema";
import type { CV } from "#/lib/cv/schema";
import type { TemplateId } from "#/lib/cv/templates";
import { listVersions, saveVersion } from "#/lib/cv/versions";
import type { StoredVersion } from "#/lib/cv/versions";
import { m } from "#/paraglide/messages.js";

import { describeChange } from "./history-label";

export interface Doc {
  cv: CV;
  template: TemplateId;
}

/** How long after the last change a version is written to the database. */
const PERSIST_MS = 900;

const fromStored = (v: StoredVersion): Version<Doc> => ({
  id: v.id,
  at: v.at,
  label: v.label,
  source: v.source,
  doc: { cv: v.cv, template: v.template as TemplateId },
});

const sameDoc = (a: Doc, b: Doc) =>
  a.template === b.template && JSON.stringify(a.cv) === JSON.stringify(b.cv);

const seed = (
  current: Doc,
  stored: StoredVersion[]
): { versions: Version<Doc>[]; cursor: number } => {
  const versions = stored.map(fromStored);
  if (versions.length === 0) {
    return {
      cursor: 0,
      versions: [
        {
          id: newId(),
          at: Date.now(),
          label: m.hist_original(),
          source: "you",
          doc: current,
        },
      ],
    };
  }
  let same = versions.length - 1;
  while (same >= 0 && !sameDoc(versions[same].doc, current)) {
    same -= 1;
  }
  if (same !== -1) {
    // Show the database copy as the one on screen.
    versions[same] = { ...versions[same], doc: current };
    return { versions, cursor: same };
  }
  const last = versions.at(-1) as Version<Doc>;
  versions.push({
    id: newId(),
    at: Date.now(),
    label: describeChange(last.doc, current, changedPaths(last.doc, current)),
    source: "you",
    doc: current,
  });
  return { versions, cursor: versions.length - 1 };
};

const describeEdit = (prev: Doc, next: Doc): CommitMeta => {
  const paths = changedPaths(prev, next);
  return {
    label: describeChange(prev, next, paths),
    source: "you",
    group: editGroup(paths, prev, next),
  };
};

export const useHistory = (
  cvId: string,
  initial: Doc,
  stored: StoredVersion[],
  moreStored: boolean
) => {
  const [timeline, dispatch] = useReducer(
    timelineReducer as (
      s: Timeline<Doc>,
      a: TimelineAction<Doc>
    ) => Timeline<Doc>,
    null,
    () => {
      const { versions, cursor } = seed(initial, stored);
      return createTimeline(versions, cursor);
    }
  );
  const current = timeline.versions[timeline.cursor];
  const { doc } = current;

  const commit = useCallback(
    (
      update: (d: Doc) => Doc,
      meta?: Omit<CommitMeta, "source"> & {
        source?: CommitMeta["source"];
      }
    ) =>
      dispatch({
        type: "commit",
        update,
        now: Date.now(),
        describe: meta
          ? (prev, next) => ({
              label: meta.label || describeEdit(prev, next).label,
              group: meta.group,
              source: meta.source ?? "you",
            })
          : describeEdit,
      }),
    []
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const jump = useCallback(
    (index: number) => dispatch({ type: "jump", index }),
    []
  );
  /** Ends the current typing/AI step, so the next change starts a new one. */
  const seal = useCallback(() => dispatch({ type: "seal" }), []);

  // Write versions whose content changed since they were last saved.
  // Versions loaded from the database count as saved.
  const [saved, setSaved] = useState(() => {
    const ids = new Set(stored.map((v) => v.id));
    return new Map(
      timeline.versions.filter((v) => ids.has(v.id)).map((v) => [v.id, v.doc])
    );
  });
  const pending = useMemo(
    () => timeline.versions.filter((v) => saved.get(v.id) !== v.doc),
    [saved, timeline.versions]
  );
  const persist = useCallback(async () => {
    for (const v of pending) {
      const docAtSend = v.doc;
      try {
        // One at a time and in order, so an older version never lands last.
        // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
        await saveVersion({
          cvId,
          id: v.id,
          at: v.at,
          label: v.label,
          source: v.source,
          template: v.doc.template,
          data: v.doc.cv,
        });
        setSaved((prev) => new Map(prev).set(v.id, docAtSend));
      } catch {
        // Kept pending; the next change retries.
      }
    }
  }, [cvId, pending]);
  const persistLater = useEffectEvent(() => {
    persist();
  });
  // Runs when a version becomes unsaved, not on every keystroke.
  const pendingKey = pending.map((v) => v.id).join(",");
  useEffect(() => {
    if (pendingKey === "") {
      return;
    }
    const t = setTimeout(persistLater, PERSIST_MS);
    return () => clearTimeout(t);
  }, [pendingKey]);

  const [hasOlder, setHasOlder] = useState(moreStored);
  const loadOlder = useCallback(async () => {
    const [first] = timeline.versions;
    if (!hasOlder) {
      return;
    }
    const page = await listVersions({ cvId, before: first.at });
    setHasOlder(page.more);
    const older = page.versions.map(fromStored);
    setSaved((prev) => {
      const next = new Map(prev);
      for (const v of older) {
        next.set(v.id, v.doc);
      }
      return next;
    });
    dispatch({ type: "prepend", versions: older });
  }, [cvId, hasOlder, timeline.versions]);

  return useMemo(
    () => ({
      doc,
      commit,
      undo,
      redo,
      jump,
      seal,
      persist,
      loadOlder,
      hasOlder,
      versions: timeline.versions,
      cursor: timeline.cursor,
      canUndo: timeline.cursor > 0,
      canRedo: timeline.cursor < timeline.versions.length - 1,
    }),
    [
      doc,
      commit,
      undo,
      redo,
      jump,
      seal,
      persist,
      loadOlder,
      hasOlder,
      timeline,
    ]
  );
};
