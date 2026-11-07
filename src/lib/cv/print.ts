import { call } from "#/lib/api";

/** A CV for the PDF/PNG renderer; null when the token is wrong or expired. */
export const getPrintCv = async ({
  id,
  token,
}: {
  id: string;
  token: string;
}) =>
  await call((client) =>
    client.api.print[":id"].$get({ param: { id }, query: { token } })
  );
