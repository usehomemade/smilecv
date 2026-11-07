import { Download01Icon } from "@hugeicons-pro/core-stroke-rounded";
import {
  createFileRoute,
  Link,
  useNavigate,
  getRouteApi,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import {
  fmtBytes,
  fmtDate,
  Pager,
  PageTitle,
  Panel,
  SearchBox,
  Table,
  Tag,
  Td,
} from "#/components/admin/ui";
import { Icon } from "#/components/icon";
import { listAdminFiles } from "#/lib/admin/functions";
import { m } from "#/paraglide/messages.js";

const routeApi = getRouteApi("/admin/files");

const search = z.object({
  q: z.string().optional(),
  page: z.number().int().min(0).optional(),
});

const Files = () => {
  const data = routeApi.useLoaderData();
  const s = routeApi.useSearch();
  const navigate = useNavigate({ from: "/admin/files" });
  const onQuery = useCallback(
    (q: string) => navigate({ search: { q: q || undefined, page: undefined } }),
    [navigate]
  );
  const setPage = useCallback(
    (page: number) =>
      navigate({ search: (prev) => ({ ...prev, page: page || undefined }) }),
    [navigate]
  );
  return (
    <>
      <PageTitle
        description={m.admin_files_body({ size: fmtBytes(data.bytes) })}
        title={m.admin_nav_files()}
      >
        <SearchBox
          onChange={onQuery}
          placeholder={m.admin_search_files()}
          value={s.q ?? ""}
        />
      </PageTitle>
      <Panel>
        <Table
          empty={data.rows.length === 0}
          head={[
            m.admin_col_file(),
            m.admin_col_user(),
            m.admin_col_cv(),
            m.admin_col_size(),
            m.admin_col_uploaded(),
            "",
          ]}
        >
          {data.rows.map((f) => (
            <tr className="hover:bg-foreground/[0.02]" key={f.id}>
              <Td>
                <span className="block max-w-[280px] truncate font-medium">
                  {f.name}
                </span>
                <span className="text-muted-foreground block text-[12px]">
                  {f.mediaType}
                </span>
              </Td>
              <Td>
                <Link
                  className="flex max-w-[240px] items-center gap-1.5 truncate hover:underline"
                  params={{ id: f.userId }}
                  to="/admin/users/$id"
                >
                  {f.isAnonymous ? <Tag>{m.admin_guest()}</Tag> : f.userEmail}
                </Link>
              </Td>
              <Td>
                <Link
                  className="block max-w-[200px] truncate hover:underline"
                  params={{ id: f.cvId }}
                  to="/admin/cvs/$id"
                >
                  {f.cvTitle}
                </Link>
              </Td>
              <Td className="tabular-nums">{fmtBytes(f.size)}</Td>
              <Td className="text-muted-foreground">{fmtDate(f.createdAt)}</Td>
              <Td className="text-end">
                <a
                  aria-label={m.admin_download()}
                  className="text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground inline-flex rounded-full p-1.5"
                  href={`/api/admin/files/${f.id}`}
                >
                  <Icon className="size-4" icon={Download01Icon} />
                </a>
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

export const Route = createFileRoute("/admin/files")({
  validateSearch: search,
  loaderDeps: ({ search: s }) => s,
  loader: ({ deps }) => listAdminFiles(deps),
  component: Files,
});
