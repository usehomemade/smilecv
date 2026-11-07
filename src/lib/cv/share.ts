import { call } from "#/lib/api";

/**
 * Turn the public link on or off, and choose whether it shows the chat.
 * Switching off clears the link id, so an old link stops working.
 */
export const setSharing = async ({
  id,
  ...json
}: {
  id: string;
  enabled?: boolean;
  chat?: boolean;
}) =>
  await call((client) =>
    client.api.cvs[":id"].sharing.$put({ param: { id }, json })
  );

/** Empty the AI chat of a CV. */
export const clearChat = async ({ id }: { id: string }) =>
  await call((client) => client.api.cvs[":id"].chat.$delete({ param: { id } }));

/** A shared CV as anyone with the link sees it. */
export const getSharedCv = async ({ shareId }: { shareId: string }) =>
  await call((client) =>
    client.api.shared[":shareId"].$get({ param: { shareId } })
  );
