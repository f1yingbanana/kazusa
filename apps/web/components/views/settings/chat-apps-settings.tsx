"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  HashIcon,
  KeyRoundIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BridgeStatus } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAccess } from "@/hooks/use-access";
import { useBridgeAccount } from "@/hooks/use-bridge-account";
import { useBridges } from "@/hooks/use-bridges";
import { useChatTitle } from "@/components/entities/chips";
import { makeLinkCode, unlinkAccount } from "@/lib/source/bridges/http";
import { createOpenGroup } from "@/lib/source/chats/http";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

function failed(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/** One row of an app's list: what it is on the left, what to do on the right. */
function Row({
  icon,
  title,
  detail,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  /** What opens under the row: a form, a code. */
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          {detail ? (
            <span className="text-xs text-pretty text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </div>
        {action}
      </div>
      {children ? <div className="pl-10">{children}</div> : null}
    </li>
  );
}

/** The bot's state as a dot and a few words, for the app's heading. */
function BotState({ status }: { status: BridgeStatus | "unknown" }) {
  const state = status === "unknown" ? "off" : status.state;
  const label =
    state === "connected"
      ? "Connected"
      : state === "connecting"
        ? "Connecting"
        : state === "failed"
          ? "Couldn't connect"
          : "Not connected";
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "connected"
            ? "bg-online"
            : state === "failed"
              ? "bg-destructive"
              : state === "connecting"
                ? "animate-pulse bg-muted-foreground motion-reduce:animate-none"
                : "bg-muted-foreground/40",
        )}
      />
      <span role="status">{label}</span>
    </span>
  );
}

/**
 * The person's own Discord account. Linked, what they write in a linked channel
 * is said by whoever they play, in place of their own message. They prove the
 * account is theirs with a code sent from Discord: `/link`, or the code alone
 * in a direct message to the bot.
 */
function AccountRow({ bot }: { bot: string | null }) {
  const [code, setCode] = useState<{ code: string; until: number } | null>(
    null,
  );
  const { data, mutate } = useBridgeAccount(code !== null);
  const [busy, setBusy] = useState(false);
  const linked = data?.account;

  // Linked from Discord while the code was out: done with the code.
  useEffect(() => {
    if (!code || !linked || linked.linkedAt < code.until - 10 * 60_000) return;
    setCode(null);
    toast.success(`Linked to ${linked.name}`);
  }, [code, linked]);

  // A code works for ten minutes: after that it's gone, and so is the wait.
  useEffect(() => {
    if (!code) return;
    const left = code.until - Date.now();
    if (left <= 0) {
      setCode(null);
      return;
    }
    const timer = setTimeout(() => {
      setCode(null);
      toast.message("The code ran out. Make a new one to link.");
    }, left);
    return () => clearTimeout(timer);
  }, [code]);

  async function start() {
    setBusy(true);
    try {
      setCode(await makeLinkCode());
    } catch (error) {
      failed("Couldn't make a code", error);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await mutate(await unlinkAccount(), { revalidate: false });
      toast.success("Unlinked");
    } catch (error) {
      failed("Couldn't unlink", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row
      icon={<UserRoundIcon />}
      title={linked ? linked.name : "Your account"}
      detail={
        linked
          ? "Your account, so the bot knows which Discord user is you."
          : bot
            ? "Link your account so the bot knows which Discord user is you."
            : "Linking needs a connected bot."
      }
      action={
        !data ? (
          <Spinner />
        ) : linked ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void unlink()}
          >
            Unlink
          </Button>
        ) : code ? (
          <Button variant="ghost" size="sm" onClick={() => setCode(null)}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !bot}
            onClick={() => void start()}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Link
          </Button>
        )
      }
    >
      {code && !linked ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 px-3 py-2.5">
          <span
            aria-label="Link code"
            className="font-mono text-lg font-semibold tracking-[0.25em] select-all"
          >
            {code.code}
          </span>
          <span className="text-xs text-pretty text-muted-foreground">
            Send it to {bot} in a direct message, or type{" "}
            <code className="font-mono">/link {code.code}</code> in its server.
            It works once, for ten minutes.
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Waiting for Discord
          </span>
        </div>
      ) : null}
    </Row>
  );
}

/** The bot's token: replaced or removed in place, never shown again. */
function BotRow({
  status,
  hasToken,
  onSave,
}: {
  status: BridgeStatus;
  hasToken: boolean;
  onSave: (token: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(next: string | null) {
    setSaving(true);
    try {
      await onSave(next);
      setToken("");
      setEditing(false);
    } catch (error) {
      failed("Couldn't save the token", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Row
      icon={<KeyRoundIcon />}
      title={status.state === "connected" ? status.name : "Bot"}
      detail={
        status.state === "failed"
          ? status.error.replace(/^Error: /, "")
          : status.state === "connected"
            ? "The bot that delivers messages between Kazusa and Discord."
            : hasToken
              ? "A token is saved."
              : "No bot yet. Set one up below, then add its token."
      }
      action={
        editing ? null : (
          <Button
            variant={hasToken ? "ghost" : "outline"}
            size="sm"
            onClick={() => setEditing(true)}
          >
            {hasToken ? "Change token" : "Add token"}
          </Button>
        )
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim()) void save(token.trim());
          }}
        >
          <Input
            aria-label="Bot token"
            type="password"
            autoComplete="off"
            autoFocus
            placeholder="Paste the bot's token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!token.trim() || saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Connect
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setToken("");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            {hasToken ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => void save(null)}
              >
                Remove token
              </Button>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            Kept on this computer with your provider keys, and never shown
            again.
          </span>
        </form>
      ) : null}
    </Row>
  );
}

/** A linked channel: Discord's names for it, the group, what's wrong. */
function ChannelRow({
  chatId,
  channelId,
  channelName,
  server,
  problem,
}: {
  chatId: string;
  channelId: string;
  channelName?: string;
  server?: string;
  problem?: string;
}) {
  const { title } = useChatTitle(chatId);
  return (
    <Row
      icon={<HashIcon />}
      title={
        channelName ? (
          <>
            {channelName}
            {server ? (
              <span className="font-normal text-muted-foreground">
                {` in ${server}`}
              </span>
            ) : null}
          </>
        ) : (
          <span className="font-mono text-xs">{channelId}</span>
        )
      }
      detail={
        problem ? (
          <span role="alert" className="text-destructive">
            {problem}
          </span>
        ) : (
          `Linked to ${title}`
        )
      }
    />
  );
}

/**
 * A group made for a channel: open to join and empty, linked at once, so
 * whoever comes in from Discord or the world fills it.
 */
function NewChannelGroup({
  link,
}: {
  link: (chatId: string, channelId: string | null) => Promise<void>;
}) {
  const { reload } = useObservedChats();
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [saving, setSaving] = useState(false);
  const created = useRef<{ title: string; chatId: string } | null>(null);
  const named = title.trim();
  const channelId = channel.trim();

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!named || !channelId) return;
    setSaving(true);
    try {
      const chatId =
        created.current?.title === named
          ? created.current.chatId
          : await createOpenGroup(named);
      created.current = { title: named, chatId };
      await link(chatId, channelId);
      await reload();
      created.current = null;
      setTitle("");
      setChannel("");
      toast.success(`Made ${named} for that channel`);
    } catch (error) {
      failed("Couldn't make the group", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-2" noValidate>
      <p className="text-sm text-muted-foreground">
        A new group for a channel: open to join, so characters and guests come
        in by themselves.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Group name"
          placeholder="Group name"
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          className="h-8 min-w-40 flex-1"
        />
        <Input
          aria-label="Channel ID"
          placeholder="Channel ID"
          inputMode="numeric"
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          className="h-8 min-w-40 flex-1 font-mono text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!named || !channelId || saving}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Make group
        </Button>
      </div>
    </form>
  );
}

/** How to make a bot, in order: only needed once, so folded away. */
function BotSetup() {
  return (
    <Collapsible className="group/setup">
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
        <ChevronRightIcon
          aria-hidden
          className="size-4 transition-transform group-data-open/setup:rotate-90 motion-reduce:transition-none"
        />
        Setting up a bot
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 ml-5 flex list-decimal flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
          <li>
            In the{" "}
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Discord Developer Portal
            </a>
            , make an application. Its Bot page has the token.
          </li>
          <li>On the Bot page, switch on the Message Content intent.</li>
          <li>
            Under OAuth2, URL Generator, tick the bot and applications.commands
            scopes, and the View Channels, Send Messages, Read Message History,
            Manage Webhooks, Manage Messages and Add Reactions permissions. Open
            the link to add the bot to your server.
          </li>
          <li>Add the token here.</li>
          <li>
            Link a group or direct chat from its sidebar, with the
            channel&apos;s ID: in Discord with Developer Mode on, right-click
            the channel, then Copy Channel ID.
          </li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Chat apps: one list per app. Everyone who plays links their own account; the
 * owner also has the app's bot and its linked channels. Discord for now.
 */
export function ChatAppsSettings() {
  const { canManage } = useAccess();
  const bridges = useBridges();
  const account = useBridgeAccount();
  const status: BridgeStatus | "unknown" =
    bridges.data?.discord.status ??
    (account.data
      ? account.data.bot
        ? { state: "connected", name: account.data.bot }
        : { state: "off" }
      : "unknown");
  const bot =
    status !== "unknown" && status.state === "connected" ? status.name : null;
  const links = bridges.data?.links ?? [];

  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Discord"
        description="Send and receive messages directly in Discord."
        action={<BotState status={status} />}
      >
        {bridges.error || account.error ? (
          <p className="text-sm text-destructive">
            {(bridges.error ?? account.error)?.message}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          <AccountRow bot={bot} />
          {canManage && bridges.data ? (
            <BotRow
              status={bridges.data.discord.status}
              hasToken={bridges.data.discord.hasToken}
              onSave={bridges.saveToken}
            />
          ) : null}
        </ul>
        {canManage ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              Linked channels
            </h4>
            {links.length ? (
              <ul className="flex flex-col divide-y rounded-lg border bg-card">
                {links.map((link) => (
                  <ChannelRow key={link.chatId} {...link} />
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                No channel yet. Link one from a chat sidebar, or make a group
                for one below.
              </p>
            )}
            {bot ? <NewChannelGroup link={bridges.link} /> : null}
          </div>
        ) : null}
        {canManage ? <BotSetup /> : null}
      </SettingsSection>
    </div>
  );
}
