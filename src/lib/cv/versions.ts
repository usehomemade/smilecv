import { call } from "#/lib/api";

import type { CV } from "./schema";
import type { TemplateId } from "./templates";

export interface StoredVersion {
  at: number;
  cv: CV;
  id: string;
  label: string;
  source: "you" | "ai" | "restore";
  template: string;
}

/** Versions of a CV, oldest first; `before` pages further back. */
export const listVersions = async ({
  cvId,
  before,
  limit,
}: {
  cvId: string;
  before?: number;
  limit?: number;
}): Promise<{ versions: StoredVersion[]; more: boolean }> =>
  await call((client) =>
    client.api.cvs[":cvId"].versions.$get({
      param: { cvId },
      query: {
        before: before === undefined ? undefined : String(before),
        limit: limit === undefined ? undefined : String(limit),
      },
    })
  );

/**
 * Store a version. The newest version keeps absorbing typing, so the same id
 * is saved again with newer content (upsert).
 */
export const saveVersion = async ({
  cvId,
  id,
  ...json
}: {
  cvId: string;
  id: string;
  at: number;
  label: string;
  source: StoredVersion["source"];
  template: TemplateId;
  data: CV;
}) =>
  await call((client) =>
    client.api.cvs[":cvId"].versions[":id"].$put({
      param: { cvId, id },
      json,
    })
  );
