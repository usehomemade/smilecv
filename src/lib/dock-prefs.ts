import { call } from "#/lib/api";

export type DockSide = "left" | "right";
export interface DockPrefs {
  /** Collapsed to a small button (desktop). */
  minimized: boolean;
  side: DockSide;
  width: number;
}

export const DOCK_COOKIE = "cv_dock";
export const DOCK_MIN_W = 320;
export const DOCK_MAX_W = 640;
export const DEFAULT_DOCK: DockPrefs = {
  side: "left",
  width: 400,
  minimized: false,
};

export const parseDock = (raw: string | undefined | null): DockPrefs => {
  try {
    const v = JSON.parse(decodeURIComponent(raw ?? ""));
    return {
      side: v.side === "right" ? "right" : "left",
      width: Math.min(DOCK_MAX_W, Math.max(DOCK_MIN_W, Number(v.width) || 400)),
      minimized: v.minimized === true,
    };
  } catch {
    return DEFAULT_DOCK;
  }
};

/**
 * Read on the server so the editor renders the chat card at its saved side
 * and width from the first paint (no layout shift on reload).
 */
export const getDockPrefs = async (): Promise<DockPrefs> =>
  await call((client) => client.api["dock-prefs"].$get());
