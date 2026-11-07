import { call } from "#/lib/api";
import type { CV } from "#/lib/cv/schema";
import type { TemplateId } from "#/lib/cv/templates";

/** The signed-in user (or guest) with their free limits; null when signed out. */
export const getViewer = async () =>
  await call((client) => client.api.viewer.$get());

/** Which sign-in methods are set up. */
export const getAuthOptions = async () =>
  await call((client) => client.api["auth-options"].$get());

/** The viewer's CVs, newest first. */
export const listCvs = async () =>
  await call((client) => client.api.cvs.$get());

/** One of the viewer's CVs with its chat; null when not found. */
export const getCv = async ({ id }: { id: string }) =>
  await call((client) => client.api.cvs[":id"].$get({ param: { id } }));

export const updateCv = async ({
  id,
  ...json
}: {
  id: string;
  title?: string;
  template?: TemplateId;
  data?: CV;
  pages?: number;
}) =>
  await call((client) => client.api.cvs[":id"].$patch({ param: { id }, json }));

export const duplicateCv = async ({ id }: { id: string }) =>
  await call((client) =>
    client.api.cvs[":id"].duplicate.$post({ param: { id } })
  );

export const deleteCv = async ({ id }: { id: string }) =>
  await call((client) => client.api.cvs[":id"].$delete({ param: { id } }));

export const createCv = async (json: {
  template?: TemplateId;
  sample?: boolean;
  title?: string;
  /** The creator's UI locale; headings and title of a new CV use it. */
  locale?: string;
}) => await call((client) => client.api.cvs.$post({ json }));
