import {
  Delete02Icon,
  Download01Icon,
  UserBlock01Icon,
  UserCheck01Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useRouter,
  getRouteApi,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";

import {
  fmtAgo,
  fmtBytes,
  fmtDate,
  fmtInt,
  fmtUsd,
  PageTitle,
  Panel,
  Stat,
  Table,
  Tag,
  Td,
  UserAvatar,
} from "#/components/admin/ui";
import { Icon } from "#/components/icon";
import { CvThumb } from "#/components/primitives";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import {
  banAdminUser,
  deleteAdminUser,
  getAdminUser,
  sendAdminVerification,
  setAdminEmailVerified,
  unbanAdminUser,
} from "#/lib/admin/functions";
import { m } from "#/paraglide/messages.js";

const routeApi = getRouteApi("/admin/users/$id");

type Data = NonNullable<Awaited<ReturnType<typeof getAdminUser>>>;

const providerLabel = (id: string) => {
  if (id === "credential") {
    return m.admin_provider_email();
  }
  if (id === "google") {
    return m.admin_provider_google();
  }
  return id;
};

const VerifiedTag = ({ user }: { user: Data["user"] }) => {
  const google =
    user.providers.includes("google") && !user.providers.includes("credential");
  if (google) {
    return <Tag tone="good">{m.admin_verified_google()}</Tag>;
  }
  return user.emailVerified ? (
    <Tag tone="good">{m.admin_verified()}</Tag>
  ) : (
    <Tag tone="warn">{m.admin_unverified()}</Tag>
  );
};

/** Runs an admin action; a failure becomes an error toast. Never throws. */
const withAdminToast = async (action: () => Promise<void>) => {
  try {
    await action();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : m.admin_failed());
  }
};

const EmailPanel = ({ user }: { user: Data["user"] }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const send = useCallback(async () => {
    setBusy(true);
    await withAdminToast(async () => {
      await sendAdminVerification({ id: user.id });
      toast.success(m.admin_verify_sent());
    });
    setBusy(false);
  }, [user.id]);
  const openConfirm = useCallback(() => setConfirm(true), []);
  const toggle = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      await withAdminToast(async () => {
        await setAdminEmailVerified({
          id: user.id,
          verified: !user.emailVerified,
        });
        toast.success(
          user.emailVerified
            ? m.admin_marked_unverified()
            : m.admin_marked_verified()
        );
        setConfirm(false);
        await router.invalidate();
      });
      setBusy(false);
    },
    [user.id, user.emailVerified, router]
  );
  return (
    <Panel className="mt-3" title={m.admin_email_title()}>
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-[13.5px]">
          <span className="truncate">{user.email}</span>
          <VerifiedTag user={user} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.emailVerified ? (
            <>
              <Button disabled size="sm" variant="outline">
                {m.admin_verify_send()}
              </Button>
              <Button disabled={busy} onClick={send} size="sm" variant="ghost">
                {m.admin_verify_send_anyway()}
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={send} size="sm" variant="outline">
              {m.admin_verify_send()}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={openConfirm}
            size="sm"
            variant="ghost"
          >
            {user.emailVerified
              ? m.admin_mark_unverified()
              : m.admin_mark_verified()}
          </Button>
        </div>
      </div>
      <AlertDialog onOpenChange={setConfirm} open={confirm}>
        <AlertDialogContent>
          <form onSubmit={toggle}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {user.emailVerified
                  ? m.admin_mark_unverified_title()
                  : m.admin_mark_verified_title()}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {user.emailVerified
                  ? m.admin_mark_unverified_body()
                  : m.admin_mark_verified_body()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel type="button">
                {m.admin_cancel()}
              </AlertDialogCancel>
              <Button disabled={busy} type="submit">
                {user.emailVerified
                  ? m.admin_mark_unverified()
                  : m.admin_mark_verified()}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
};

const FilesTable = ({ files }: { files: Data["files"] }) => (
  <Table
    empty={files.length === 0}
    head={[
      m.admin_col_file(),
      m.admin_col_type(),
      m.admin_col_size(),
      m.admin_col_uploaded(),
      "",
    ]}
  >
    {files.map((f) => (
      <tr key={f.id}>
        <Td className="max-w-[320px] truncate font-medium">{f.name}</Td>
        <Td className="text-muted-foreground">{f.mediaType}</Td>
        <Td className="tabular-nums">{fmtBytes(f.size)}</Td>
        <Td className="text-muted-foreground">{fmtDate(f.createdAt)}</Td>
        <Td className="text-end">
          <a
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[13px]"
            href={`/api/admin/files/${f.id}`}
          >
            <Icon className="size-4" icon={Download01Icon} />
            {m.admin_download()}
          </a>
        </Td>
      </tr>
    ))}
  </Table>
);

const UserActions = ({ user }: { user: Data["user"] }) => {
  const router = useRouter();
  const navigate = useNavigate();
  const [banOpen, setBanOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("0");
  const [busy, setBusy] = useState(false);
  const openBan = useCallback(() => setBanOpen(true), []);
  const openDelete = useCallback(() => setDeleteOpen(true), []);
  const onReason = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value),
    []
  );
  const onDays = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => setDays(e.target.value),
    []
  );

  const ban = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      await withAdminToast(async () => {
        await banAdminUser({
          id: user.id,
          reason: reason || undefined,
          days: Number(days) || undefined,
        });
        toast.success(m.admin_ban_done());
        setBanOpen(false);
        await router.invalidate();
      });
      setBusy(false);
    },
    [user.id, reason, days, router]
  );

  const unban = useCallback(async () => {
    setBusy(true);
    await withAdminToast(async () => {
      await unbanAdminUser({ id: user.id });
      toast.success(m.admin_unban_done());
      await router.invalidate();
    });
    setBusy(false);
  }, [user.id, router]);

  const remove = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try {
        await deleteAdminUser({ id: user.id });
        toast.success(m.admin_delete_done());
        await navigate({ to: "/admin/users" });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : m.admin_failed());
        setBusy(false);
      }
    },
    [user.id, navigate]
  );

  if (user.isAdmin) {
    return null;
  }
  return (
    <>
      {user.banned ? (
        <Button disabled={busy} onClick={unban} variant="outline">
          <Icon data-icon="inline-start" icon={UserCheck01Icon} />
          {m.admin_unban()}
        </Button>
      ) : (
        <Button onClick={openBan} variant="outline">
          <Icon data-icon="inline-start" icon={UserBlock01Icon} />
          {m.admin_ban()}
        </Button>
      )}
      <Button onClick={openDelete} variant="destructive">
        <Icon data-icon="inline-start" icon={Delete02Icon} />
        {m.admin_delete()}
      </Button>

      <AlertDialog onOpenChange={setBanOpen} open={banOpen}>
        <AlertDialogContent>
          <form onSubmit={ban}>
            <AlertDialogHeader>
              <AlertDialogTitle>{m.admin_ban_title()}</AlertDialogTitle>
              <AlertDialogDescription>
                {m.admin_ban_body()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 text-[13px]">
                <label className="font-medium" htmlFor="ban-reason">
                  {m.admin_ban_reason()}
                </label>
                <Textarea
                  id="ban-reason"
                  maxLength={500}
                  onChange={onReason}
                  placeholder={m.admin_ban_reason_placeholder()}
                  rows={3}
                  value={reason}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                <label className="font-medium" htmlFor="ban-length">
                  {m.admin_ban_length()}
                </label>
                <NativeSelect id="ban-length" onChange={onDays} value={days}>
                  <NativeSelectOption value="0">
                    {m.admin_ban_forever()}
                  </NativeSelectOption>
                  <NativeSelectOption value="1">
                    {m.admin_ban_days({ count: 1 })}
                  </NativeSelectOption>
                  <NativeSelectOption value="7">
                    {m.admin_ban_days({ count: 7 })}
                  </NativeSelectOption>
                  <NativeSelectOption value="30">
                    {m.admin_ban_days({ count: 30 })}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel type="button">
                {m.admin_cancel()}
              </AlertDialogCancel>
              <Button disabled={busy} type="submit" variant="destructive">
                {m.admin_ban()}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <form onSubmit={remove}>
            <AlertDialogHeader>
              <AlertDialogTitle>{m.admin_delete_title()}</AlertDialogTitle>
              <AlertDialogDescription>
                {m.admin_delete_body()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel type="button">
                {m.admin_cancel()}
              </AlertDialogCancel>
              <Button disabled={busy} type="submit" variant="destructive">
                {m.admin_delete()}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const UserDetail = () => {
  const { user, cvs, files, usage } = routeApi.useLoaderData();
  const title = user.isAnonymous ? m.admin_guest() : user.name || user.email;
  return (
    <>
      <Link
        className="text-muted-foreground hover:text-foreground mb-3 inline-block text-[13px]"
        to="/admin/users"
      >
        {m.admin_back_users()}
      </Link>
      <PageTitle
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{user.isAnonymous ? user.id : user.email}</span>
            {user.providers.map((p) => (
              <Tag key={p}>{providerLabel(p)}</Tag>
            ))}
            {user.isAnonymous ? <Tag>{m.admin_guest()}</Tag> : null}
            {user.isAnonymous ? null : <VerifiedTag user={user} />}
            {user.banned ? <Tag tone="danger">{m.admin_banned()}</Tag> : null}
            {user.isAdmin ? <Tag tone="good">{m.admin_badge()}</Tag> : null}
          </span>
        }
        title={
          <span className="flex items-center gap-3">
            <UserAvatar
              className="size-10 text-[15px]"
              image={user.image}
              name={user.name || user.email}
            />
            {title}
          </span>
        }
      >
        <UserActions user={user} />
      </PageTitle>

      {user.banned ? (
        <div className="bg-destructive/[0.06] text-destructive ring-destructive/15 mb-4 rounded-[14px] px-4 py-3 text-[13.5px] ring-1">
          {m.admin_banned_note({
            reason: user.banReason || m.admin_no_reason(),
            until: user.banExpires
              ? fmtDate(user.banExpires)
              : m.admin_ban_forever(),
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          hint={fmtDate(user.createdAt)}
          label={m.admin_col_created()}
          value={fmtAgo(user.createdAt)}
        />
        <Stat
          hint={user.userAgent ?? undefined}
          label={m.admin_col_last_active()}
          value={fmtAgo(user.lastSeen)}
        />
        <Stat
          hint={m.admin_tokens({
            input: fmtInt(usage.inputTokens),
            output: fmtInt(usage.outputTokens),
          })}
          label={m.admin_col_ai_cost()}
          value={fmtUsd(usage.cost)}
        />
        <Stat
          hint={m.admin_errors_count({ count: usage.errors })}
          label={m.admin_col_ai_messages()}
          value={fmtInt(usage.chats)}
        />
      </div>

      {user.isAnonymous ? null : <EmailPanel user={user} />}

      <h2 className="mt-8 mb-3 text-[16px] font-semibold">
        {m.admin_cvs_title({ count: cvs.length })}
      </h2>
      {cvs.length === 0 ? (
        <p className="text-muted-foreground text-[13.5px]">{m.admin_empty()}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {cvs.map((cv) => (
            <Link
              className="group flex min-w-0 flex-col gap-2"
              key={cv.id}
              params={{ id: cv.id }}
              to="/admin/cvs/$id"
            >
              <CvThumb
                className="rounded-[8px] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_18px_-6px_rgba(0,0,0,0.15)] ring-1 ring-black/[0.05] transition-transform duration-200 ease-out group-hover:-translate-y-0.5"
                cv={cv.data}
                template={cv.template}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">
                  {cv.title}
                </span>
                <span className="text-muted-foreground block truncate text-[12px]">
                  {m.admin_cv_meta({
                    template: cv.template,
                    messages: cv.messages,
                    when: fmtAgo(cv.updatedAt),
                  })}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Panel
          action={
            <Link
              className="text-muted-foreground hover:text-foreground text-[13px]"
              search={{ userId: user.id }}
              to="/admin/usage"
            >
              {m.admin_see_ai_usage()}
            </Link>
          }
          title={m.admin_files_title({ count: files.length })}
        >
          <FilesTable files={files} />
        </Panel>
      </div>
    </>
  );
};

export const Route = createFileRoute("/admin/users/$id")({
  loader: async ({ params }) => {
    const data = await getAdminUser({ id: params.id });
    if (!data) {
      throw notFound();
    }
    return data;
  },
  component: UserDetail,
});
