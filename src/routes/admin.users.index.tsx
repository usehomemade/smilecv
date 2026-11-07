import {
  createFileRoute,
  Link,
  useNavigate,
  getRouteApi,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import {
  fmtAgo,
  fmtDate,
  fmtInt,
  fmtUsd,
  Pager,
  PageTitle,
  Panel,
  SearchBox,
  Segmented,
  Table,
  Tag,
  Td,
  UserAvatar,
} from "#/components/admin/ui";
import { listAdminUsers } from "#/lib/admin/functions";
import { m } from "#/paraglide/messages.js";

const routeApi = getRouteApi("/admin/users/");

const search = z.object({
  q: z.string().optional(),
  filter: z.enum(["all", "registered", "guests", "banned"]).optional(),
  page: z.number().int().min(0).optional(),
});

type Filter = "all" | "registered" | "guests" | "banned";

const Users = () => {
  const data = routeApi.useLoaderData();
  const s = routeApi.useSearch();
  const navigate = useNavigate({ from: "/admin/users/" });
  const setSearch = useCallback(
    (next: Partial<z.infer<typeof search>>) =>
      navigate({ search: (prev) => ({ ...prev, page: undefined, ...next }) }),
    [navigate]
  );
  const onQuery = useCallback(
    (q: string) => setSearch({ q: q || undefined }),
    [setSearch]
  );
  const onFilter = useCallback(
    (filter: Filter) =>
      setSearch({ filter: filter === "all" ? undefined : filter }),
    [setSearch]
  );
  const setPage = useCallback(
    (page: number) =>
      navigate({ search: (prev) => ({ ...prev, page: page || undefined }) }),
    [navigate]
  );
  return (
    <>
      <PageTitle description={m.admin_users_body()} title={m.admin_nav_users()}>
        <SearchBox
          onChange={onQuery}
          placeholder={m.admin_search_users()}
          value={s.q ?? ""}
        />
      </PageTitle>
      <div className="mb-3">
        <Segmented<Filter>
          onChange={onFilter}
          options={[
            { value: "all", label: m.admin_filter_all() },
            { value: "registered", label: m.admin_registered() },
            { value: "guests", label: m.admin_guests() },
            { value: "banned", label: m.admin_banned() },
          ]}
          value={s.filter ?? "all"}
        />
      </div>
      <Panel>
        <Table
          empty={data.rows.length === 0}
          head={[
            m.admin_col_user(),
            m.admin_col_created(),
            m.admin_col_last_active(),
            m.admin_col_cvs(),
            m.admin_col_ai_messages(),
            m.admin_col_ai_cost(),
            m.admin_col_status(),
          ]}
        >
          {data.rows.map((u) => (
            <tr className="hover:bg-foreground/[0.02]" key={u.id}>
              <Td>
                <Link
                  className="flex items-center gap-2.5"
                  params={{ id: u.id }}
                  to="/admin/users/$id"
                >
                  <UserAvatar image={u.image} name={u.name || u.email} />
                  <span className="min-w-0">
                    <span className="block max-w-[260px] truncate font-medium">
                      {u.isAnonymous ? m.admin_guest() : u.name || u.email}
                    </span>
                    <span className="text-muted-foreground block max-w-[260px] truncate text-[12px]">
                      {u.isAnonymous ? u.id : u.email}
                    </span>
                  </span>
                </Link>
              </Td>
              <Td className="text-muted-foreground">
                <span title={fmtDate(u.createdAt)}>{fmtAgo(u.createdAt)}</span>
              </Td>
              <Td className="text-muted-foreground">
                <span title={fmtDate(u.lastActive)}>
                  {fmtAgo(u.lastActive)}
                </span>
              </Td>
              <Td className="tabular-nums">{fmtInt(u.cvCount)}</Td>
              <Td className="tabular-nums">{fmtInt(u.aiCount)}</Td>
              <Td className="tabular-nums">{fmtUsd(u.aiCost)}</Td>
              <Td>
                <span className="flex gap-1">
                  {u.banned ? (
                    <Tag tone="danger">{m.admin_banned()}</Tag>
                  ) : null}
                  {u.isAnonymous ? <Tag>{m.admin_guest()}</Tag> : null}
                  {u.isAnonymous || u.emailVerified ? null : (
                    <Tag tone="warn">{m.admin_unverified()}</Tag>
                  )}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
        <Pager
          hasMore={data.hasMore}
          onPage={setPage}
          page={data.page}
          total={data.total}
        />
      </Panel>
    </>
  );
};

export const Route = createFileRoute("/admin/users/")({
  validateSearch: search,
  loaderDeps: ({ search: s }) => s,
  loader: ({ deps }) => listAdminUsers(deps),
  component: Users,
});
