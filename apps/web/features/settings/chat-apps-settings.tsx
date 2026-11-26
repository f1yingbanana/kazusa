"use client";

import type { BridgeStatus } from "@kazusa/client";
import { HashIcon, KeyRoundIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/ui/toast";
import { useChatTitle } from "@/features/entities/chat-meta";
import { useAccess } from "@/hooks/use-access";
import { useBridgeAccount } from "@/hooks/use-bridge-account";
import { useBridges } from "@/hooks/use-bridges";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { makeLinkCode, unlinkAccount } from "@/lib/source/bridges/http";
import { createOpenGroup } from "@/lib/source/chats/http";
import { Button } from "@/ui/button";
import { PasswordField, TextField } from "@/ui/field";
import { Fold, Folds } from "@/ui/fold";
import { Note } from "@/ui/note";
import {
  Callout,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusPill,
  type StatusTone,
} from "@/ui/settings";

function failed(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : String(error),
  });
}

function RowBadge({ icon }: { icon: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-soft [&_svg]:size-4"
    >
      {icon}
    </span>
  );
}

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
  const tone: StatusTone =
    state === "connected"
      ? "ok"
      : state === "failed"
        ? "error"
        : state === "connecting"
          ? "pending"
          : "idle";
  return <StatusPill tone={tone} label={label} />;
}

function AccountRow({ bot }: { bot: string | null }) {
  const [code, setCode] = useState<{ code: string; until: number } | null>(
    null,
  );
  const { data, error, mutate } = useBridgeAccount(code !== null);
  const [busy, setBusy] = useState(false);
  const linked = data?.account;

  useEffect(() => {
    if (!code || !linked || linked.linkedAt < code.until - 10 * 60_000) return;
    setCode(null);
    toast.success(`Linked to ${linked.name}`);
  }, [code, linked]);

  useEffect(() => {
    if (!code) return;
    const left = code.until - Date.now();
    if (left <= 0) {
      setCode(null);
      return;
    }
    const timer = setTimeout(() => {
      setCode(null);
      toast("The code ran out. Make a new one to link.");
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
    <SettingsRow
      icon={<RowBadge icon={<UserRoundIcon />} />}
      title={linked ? linked.name : "Your account"}
      detail={
        linked
          ? "Your account, so the bot knows which Discord user is you."
          : bot
            ? "Link your account so the bot knows which Discord user is you."
            : "Linking needs a connected bot."
      }
      action={
        error && !data ? null : !data ? (
          <span className="text-xs text-ui-soft">Loading…</span>
        ) : linked ? (
          <Button
            tone="ghost"
            size="sm"
            pending={busy}
            onClick={() => void unlink()}
          >
            Unlink
          </Button>
        ) : code ? (
          <Button tone="ghost" size="sm" onClick={() => setCode(null)}>
            Cancel
          </Button>
        ) : (
          <Button
            tone="soft"
            size="sm"
            pending={busy}
            disabled={!bot}
            onClick={() => void start()}
          >
            Link
          </Button>
        )
      }
    >
      {code && !linked ? (
        <div className="flex flex-col gap-1.5 rounded-[0.875rem] bg-ui-tint px-3.5 py-2.5">
          <span
            aria-label="Link code"
            className="font-[ui-monospace,monospace] text-lg font-extrabold tracking-[0.25em] text-ui-ink select-all"
          >
            {code.code}
          </span>
          <span className="text-xs text-pretty text-ui-soft">
            Send it to {bot} in a direct message, or type{" "}
            <code className="font-[ui-monospace,monospace]">
              /link {code.code}
            </code>{" "}
            in its server. Works once for ten minutes.
          </span>
          <span className="text-xs font-semibold text-ui-soft">
            Waiting for Discord…
          </span>
        </div>
      ) : null}
    </SettingsRow>
  );
}

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
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string>();

  async function save(next: string | null) {
    setBusy(next === null ? "remove" : "save");
    setError(undefined);
    try {
      await onSave(next);
      setToken("");
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      failed("Couldn't save the token", failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsRow
      icon={<RowBadge icon={<KeyRoundIcon />} />}
      title={status.state === "connected" ? status.name : "Bot"}
      detail={
        status.state === "failed" ? (
          <span className="text-ui-danger">
            {status.error.replace(/^Error: /, "")}
          </span>
        ) : status.state === "connected" ? (
          "The bot that delivers messages between Kazusa and Discord."
        ) : hasToken ? (
          "A token is saved."
        ) : (
          "No bot yet. Set one up below, then add its token."
        )
      }
      action={
        editing ? null : (
          <Button
            tone={hasToken ? "ghost" : "soft"}
            size="sm"
            onClick={() => {
              setError(undefined);
              setEditing(true);
            }}
          >
            {hasToken ? "Change token" : "Add token"}
          </Button>
        )
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2.5 pt-1"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim()) void save(token.trim());
          }}
        >
          <PasswordField
            label="Bot token"
            autoFocus
            placeholder="Paste the bot's token"
            value={token}
            disabled={busy !== null}
            error={error}
            onValueChange={(next) => {
              setToken(next);
              setError(undefined);
            }}
            description="Kept on this computer with your provider keys, and never shown again."
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              tone="primary"
              size="sm"
              pending={busy === "save"}
              disabled={!token.trim() || busy === "remove"}
            >
              Connect
            </Button>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setToken("");
                setError(undefined);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            {hasToken ? (
              <Button
                type="button"
                tone="danger"
                size="sm"
                className="ms-auto"
                pending={busy === "remove"}
                disabled={busy === "save"}
                onClick={() => void save(null)}
              >
                Remove token
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

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
    <SettingsRow
      icon={<RowBadge icon={<HashIcon />} />}
      title={
        channelName ? (
          <>
            {channelName}
            {server ? (
              <span className="font-normal text-ui-soft">{` in ${server}`}</span>
            ) : null}
          </>
        ) : (
          <span className="font-[ui-monospace,monospace] text-xs">
            {channelId}
          </span>
        )
      }
      detail={
        problem ? (
          <span role="alert" className="text-ui-danger">
            {problem}
          </span>
        ) : (
          `Linked to ${title}`
        )
      }
    />
  );
}

function NewChannelGroup({
  disabled = false,
  link,
}: {
  disabled?: boolean;
  link: (chatId: string, channelId: string | null) => Promise<void>;
}) {
  const { reload } = useObservedChats();
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [channelError, setChannelError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const created = useRef<{ title: string; chatId: string } | null>(null);
  const named = title.trim();
  const channelId = channel.trim();

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !named || !channelId || saving) return;
    if (!/^\d+$/.test(channelId)) {
      setChannelError("Enter a numeric Discord channel ID.");
      return;
    }
    setChannelError(undefined);
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
    <form
      onSubmit={(event) => void create(event)}
      className="flex flex-col gap-3 rounded-[1rem] bg-ui-ground p-4 inset-ring inset-ring-ui-line"
      noValidate
    >
      <p className="text-xs leading-normal text-ui-soft">
        Make a new open group linked to a Discord channel so characters and
        guests can join.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Group name"
          placeholder="Lounge"
          value={title}
          maxLength={160}
          disabled={disabled || saving}
          onValueChange={setTitle}
        />
        <TextField
          label="Channel ID"
          placeholder="123456789012345678"
          inputMode="numeric"
          mono
          value={channel}
          error={channelError}
          disabled={disabled || saving}
          onValueChange={(next) => {
            setChannel(next);
            setChannelError(undefined);
          }}
        />
      </div>
      <div>
        <Button
          type="submit"
          tone="primary"
          size="sm"
          pending={saving}
          disabled={disabled || !named || !channelId}
        >
          Make group
        </Button>
      </div>
    </form>
  );
}

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
    <SettingsPage title="Chat apps" description="Connect external chat apps.">
      <SettingsSection
        title="Discord"
        description="Send and receive messages directly in Discord."
        action={<BotState status={status} />}
      >
        {bridges.error || account.error ? (
          <Callout tone="danger" title="Couldn't load Discord connection">
            {(bridges.error ?? account.error)?.message}
          </Callout>
        ) : null}

        <SettingsGroup>
          <AccountRow bot={bot} />
          {canManage && bridges.data ? (
            <BotRow
              status={bridges.data.discord.status}
              hasToken={bridges.data.discord.hasToken}
              onSave={bridges.saveToken}
            />
          ) : null}
        </SettingsGroup>

        {canManage ? (
          <div className="flex flex-col gap-3 pt-1">
            <h3 className="text-xs font-extrabold text-ui-soft">
              Linked channels
            </h3>
            {links.length ? (
              <SettingsGroup>
                {links.map((link) => (
                  <ChannelRow key={link.chatId} {...link} />
                ))}
              </SettingsGroup>
            ) : (
              <div className="rounded-[1rem] border border-dashed border-ui-line p-4">
                <Note>
                  No channel yet. Link one from a chat&apos;s details, or make a
                  group for one below.
                </Note>
              </div>
            )}
            <NewChannelGroup disabled={!bot} link={bridges.link} />
          </div>
        ) : null}

        {canManage ? (
          <Folds>
            <Fold value="bot-setup" title="Setting up a Discord bot">
              <ol className="ms-5 flex list-decimal flex-col gap-1.5 pt-1 leading-relaxed text-ui-soft">
                <li>
                  In the{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-ui-ink"
                  >
                    Discord Developer Portal
                  </a>
                  , create an application. Its Bot page holds the token.
                </li>
                <li>On the Bot page, switch on Message Content intent.</li>
                <li>
                  Under OAuth2 → URL Generator, tick{" "}
                  <code className="font-[ui-monospace,monospace] text-xs">
                    bot
                  </code>{" "}
                  and{" "}
                  <code className="font-[ui-monospace,monospace] text-xs">
                    applications.commands
                  </code>
                  , plus View Channels, Send Messages, Read Message History,
                  Manage Webhooks, Manage Messages, and Add Reactions. Open the
                  generated URL to add the bot to your server.
                </li>
                <li>Paste the bot token above and click Connect.</li>
                <li>
                  Copy a channel ID in Discord (with Developer Mode enabled) and
                  link it to a chat or create a new group above.
                </li>
              </ol>
            </Fold>
          </Folds>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}
