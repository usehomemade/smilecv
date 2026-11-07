import {
  createFileRoute,
  Link,
  useNavigate,
  getRouteApi,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import {
  fmtCompact,
  fmtDate,
  fmtDuration,
  fmtInt,
  fmtUsd,
  Pager,
  PageTitle,
  Panel,
  Segmented,
  Stat,
  Table,
  Tag,
  Td,
} from "#/components/admin/ui";
import { kindLabel, UsageSheet } from "#/components/admin/usage-sheet";
import { listAdminUsage } from "#/lib/admin/functions";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages.js";

const routeApi = getRouteApi("/admin/usage");

const search = z.object({
  kind: z.enum(["all", "chat", "translate", "faq"]).optional(),
  userId: z.string().optional(),
  errors: z.boolean().optional(),
  page: z.number().int().min(0).optional(),
  /** The request open in the detail panel. */
  id: z.string().optional(),
});

type Kind = "all" | "chat" | "translate" | "faq";

/** Tool names shown in a row; the detail panel has all of them. */
const MAX_TOOLS = 2;

const Usage = () => {
  const data = routeApi.useLoaderData();
  const s = routeApi.useSearch();
  const navigate = useNavigate({ from: "/admin/usage" });
  const clearUser = useCallback(
    () =>
      navigate({
        search: (prev) => ({ ...prev, userId: undefined, page: undefined }),
      }),
    [navigate]
  );
  const setKind = useCallback(
    (kind: Kind) =>
      navigate({
        search: (prev) => ({
          ...prev,
          kind: kind === "all" ? undefined : kind,
          page: undefined,
        }),
      }),
    [navigate]
  );
  const setErrors = useCallback(
    (v: "all" | "errors") =>
      navigate({
        search: (prev) => ({
          ...prev,
          errors: v === "errors" ? true : undefined,
          page: undefined,
        }),
      }),
    [navigate]
  );
  const setPage = useCallback(
    (page: number) =>
      navigate({ search: (prev) => ({ ...prev, page: page || undefined }) }),
    [navigate]
  );
  const closeDetail = useCallback(
    () => navigate({ search: (prev) => ({ ...prev, id: undefined }) }),
    [navigate]
  );
  return (
    <>
      {s.id ? <UsageSheet id={s.id} onClose={closeDetail} /> : null}
      <PageTitle description={m.admin_usage_body()} title={m.admin_nav_usage()}>
        {s.userId ? (
          <button
            className="bg-foreground/[0.06] cursor-pointer rounded-full px-3 py-1.5 text-[13px]"
            onClick={clearUser}
            type="button"
          >
            {m.admin_clear_user_filter()}
          </button>
        ) : null}
      </PageTitle>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={m.admin_usage_requests()} value={fmtInt(data.total)} />
        <Stat label={m.admin_usage_cost()} value={fmtUsd(data.cost)} />
        <Stat
          label={m.admin_usage_tokens()}
          value={`${fmtCompact(data.inputTokens)} / ${fmtCompact(data.outputTokens)}`}
        />
        <Stat
          label={m.admin_usage_searches()}
          value={fmtInt(data.webSearches)}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<Kind>
          onChange={setKind}
          options={[
            { value: "all", label: m.admin_filter_all() },
            { value: "chat", label: m.admin_kind_chat() },
            { value: "translate", label: m.admin_kind_translate() },
            { value: "faq", label: m.admin_kind_faq() },
          ]}
          value={s.kind ?? "all"}
        />
        <Segmented<"all" | "errors">
          onChange={setErrors}
          options={[
            { value: "all", label: m.admin_filter_all() },
            { value: "errors", label: m.admin_errors_only() },
          ]}
          value={s.errors ? "errors" : "all"}
        />
      </div>
      <Panel>
        <Table
          empty={data.rows.length === 0}
          head={[
            m.admin_col_when(),
            m.admin_col_kind(),
            m.admin_col_user(),
            m.admin_col_cv(),
            m.admin_col_tokens(),
            m.admin_col_cached(),
            m.admin_col_cost(),
            m.admin_col_duration(),
            m.admin_col_tools(),
          ]}
        >
          {data.rows.map((r) => (
            <tr
              className={cn(
                "hover:bg-foreground/[0.03] relative",
                s.id === r.id && "bg-foreground/[0.05]"
              )}
              key={r.id}
            >
              <Td className="text-muted-foreground">
                {/* Stretched link: the whole row opens the detail panel. */}
                <Link
                  aria-label={m.admin_open_detail()}
                  className="after:absolute after:inset-0 after:content-['']"
                  search={{ ...s, id: r.id }}
                  to="/admin/usage"
                >
                  {fmtDate(r.createdAt)}
                </Link>
              </Td>
              <Td>
                <span className="flex items-center gap-1.5">
                  {kindLabel(r.kind)}
                  {r.error ? (
                    <span title={r.error}>
                      <Tag tone="danger">{m.admin_error()}</Tag>
                    </span>
                  ) : null}
                </span>
              </Td>
              <Td>
                {r.userId ? (
                  <Link
                    className="relative z-10 block max-w-[200px] truncate hover:underline"
                    params={{ id: r.userId }}
                    to="/admin/users/$id"
                  >
                    {r.isAnonymous ? m.admin_guest() : r.userEmail}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </Td>
              <Td>
                {r.cvId ? (
                  <Link
                    className="relative z-10 block max-w-[160px] truncate hover:underline"
                    params={{ id: r.cvId }}
                    to="/admin/cvs/$id"
                  >
                    {r.cvTitle}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </Td>
              <Td className="tabular-nums">
                <span
                  title={m.admin_tokens_title({
                    input: fmtInt(r.inputTokens),
                    output: fmtInt(r.outputTokens),
                    reasoning: fmtInt(r.reasoningTokens),
                  })}
                >
                  {`${fmtInt(r.inputTokens)} / ${fmtInt(r.outputTokens)}`}
                </span>
              </Td>
              <Td className="text-muted-foreground tabular-nums">
                {fmtInt(r.cachedInputTokens)}
              </Td>
              <Td className="font-medium tabular-nums">{fmtUsd(r.costUsd)}</Td>
              <Td className="text-muted-foreground tabular-nums">
                {fmtDuration(r.durationMs)}
              </Td>
              <Td>
                {r.tools.length > 0 ? (
                  <span className="flex gap-1">
                    {r.tools.slice(0, MAX_TOOLS).map((tool) => (
                      <span
                        className="bg-foreground/[0.05] text-muted-foreground rounded-[6px] px-1.5 py-0.5 font-mono text-[11.5px]"
                        key={tool}
                      >
                        {tool}
                      </span>
                    ))}
                    {r.tools.length > MAX_TOOLS ? (
                      <span className="text-muted-foreground px-1 py-0.5 text-[11.5px]">
                        {`+${r.tools.length - MAX_TOOLS}`}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
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

export const Route = createFileRoute("/admin/usage")({
  validateSearch: search,
  // Opening a request's detail doesn't reload the table.
  loaderDeps: ({ search: { id: _open, ...s } }) => s,
  loader: ({ deps }) => listAdminUsage(deps),
  component: Usage,
});
