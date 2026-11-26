"use client";

import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useAccess } from "@/hooks/use-access";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { useSources } from "@/lib/source/provider";
import { Button } from "@/ui/button";
import { PasswordField, TextField } from "@/ui/field";
import { Fold, Folds } from "@/ui/fold";
import {
  Callout,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusDot,
  type StatusTone,
} from "@/ui/settings";

const STREAM_LABELS = {
  open: "Connected",
  connecting: "Reconnecting…",
  error: "Offline",
} as const;

const TOKEN_HINT = "OPENCLAW_GATEWAY_TOKEN in apps/kazusa/world/.state/.env";

interface ConnectionInfo {
  readonly url: string;
  readonly hasToken: boolean;
  readonly defaultUrl: string;
  readonly isDefault: boolean;
}

async function fetchConnection(): Promise<ConnectionInfo> {
  const response = await fetch("/connection", { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as
    (ConnectionInfo & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Couldn't read connection settings.");
  }
  return body;
}

async function sendConnection(payload: {
  url?: string;
  token?: string;
  reset?: boolean;
}): Promise<ConnectionInfo> {
  const response = await fetch("/connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    (ConnectionInfo & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Couldn't save connection settings.");
  }
  return body;
}

async function sendOwner(method: "POST" | "DELETE", token?: string) {
  const response = await fetch("/owner", {
    method,
    headers: { "Content-Type": "application/json" },
    body: token === undefined ? undefined : JSON.stringify({ token }),
  }).catch(() => null);
  if (response?.ok) return;
  const body = (await response?.json().catch(() => null)) as {
    error?: string;
  } | null;
  throw new Error(body?.error ?? "Couldn't reach Kazusa. Try again.");
}

function RemoteGatewaySection() {
  const { isLocal } = useAccess();
  const { data, error, mutate } = useSWR<ConnectionInfo, Error>(
    isLocal ? "kazusa/connection" : null,
    fetchConnection,
    { revalidateOnFocus: false },
  );
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [formError, setFormError] = useState<string>();

  if (!isLocal) return null;

  const url = urlDraft ?? data?.url ?? "";
  const dirty =
    data !== undefined && (url.trim() !== data.url || token.trim().length > 0);
  const canReset = data !== undefined && (!data.isDefault || urlDraft !== null);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || resetting) return;
    setSaving(true);
    setFormError(undefined);
    try {
      const saved = await sendConnection({
        url,
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      await mutate(saved, { revalidate: false });
      setUrlDraft(null);
      setToken("");
      toast.success("Gateway target saved", {
        description: "Reloading to connect…",
      });
      window.location.reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  }

  async function handleReset() {
    if (saving || resetting) return;
    setResetting(true);
    setFormError(undefined);
    try {
      const saved = await sendConnection({ reset: true });
      await mutate(saved, { revalidate: false });
      setUrlDraft(null);
      setToken("");
      toast.success("Restored local Gateway", {
        description: "Reloading to connect…",
      });
      window.location.reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
      setResetting(false);
    }
  }

  return (
    <SettingsSection
      title="OpenClaw Gateway target"
      description="Point this web client at your local Gateway or a remote OpenClaw server. Saved in .env.local on this machine."
    >
      {error && !data ? (
        <Callout tone="danger" title="Couldn't load Gateway target">
          {error.message}
        </Callout>
      ) : null}

      <form
        onSubmit={(event) => void handleSave(event)}
        className="flex flex-col gap-4 rounded-[1rem] bg-ui-ground p-4 inset-ring inset-ring-ui-line"
        noValidate
      >
        <TextField
          label="Gateway URL"
          type="url"
          inputMode="url"
          mono
          placeholder={data?.defaultUrl ?? "http://127.0.0.1:18789"}
          value={url}
          disabled={!data || saving || resetting}
          onChange={(event) => {
            setUrlDraft(event.target.value);
            setFormError(undefined);
          }}
          description="Use http://127.0.0.1:18789 for this computer, or your remote Tailscale / HTTPS / tunneled Gateway URL."
        />
        <PasswordField
          label="Gateway token"
          value={token}
          disabled={!data || saving || resetting}
          onValueChange={(next) => {
            setToken(next);
            setFormError(undefined);
          }}
          placeholder={
            data?.hasToken
              ? "Token saved (leave blank to keep)"
              : "Paste Gateway token"
          }
          description="Kept only on this server in .env.local and never sent to browsers."
        />
        {formError ? (
          <p role="alert" className="text-xs font-semibold text-ui-danger">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="submit"
            tone="primary"
            size="sm"
            pending={saving}
            disabled={!data || !dirty || resetting}
          >
            Save and connect
          </Button>
          {canReset ? (
            <Button
              type="button"
              tone="ghost"
              size="sm"
              pending={resetting}
              disabled={saving}
              onClick={() => void handleReset()}
            >
              Reset to local
            </Button>
          ) : null}
        </div>
      </form>

      <Folds>
        <Fold value="remote-guide" title="Connecting to a remote OpenClaw">
          <ol className="ms-5 flex list-decimal flex-col gap-1.5 leading-relaxed text-ui-soft">
            <li>
              Reach the remote Gateway over a private network or tunnel, such as
              Tailscale Serve or{" "}
              <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
                ssh -N -L 18789:127.0.0.1:18789 user@host
              </code>
              .
            </li>
            <li>
              Copy{" "}
              <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
                OPENCLAW_GATEWAY_TOKEN
              </code>{" "}
              from the remote host&apos;s{" "}
              <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
                apps/kazusa/world/.state/.env
              </code>
              .
            </li>
            <li>
              Paste the URL and token above, then click Save and connect.
              Changes apply without restarting.
            </li>
          </ol>
        </Fold>
      </Folds>
    </SettingsSection>
  );
}

function OwnerSignInSection() {
  const { access, isOwner } = useAccess();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!access.signIn) return null;

  if (isOwner) {
    return (
      <SettingsSection
        title="Owner access"
        description="This browser is signed in as the owner."
      >
        <div className="flex flex-col items-start gap-2">
          <Button
            size="sm"
            tone="soft"
            pending={busy}
            onClick={() => {
              setBusy(true);
              setError(undefined);
              void sendOwner("DELETE").then(
                () => window.location.reload(),
                (err: unknown) => {
                  setError(err instanceof Error ? err.message : String(err));
                  setBusy(false);
                },
              );
            }}
          >
            Sign out
          </Button>
          {error ? (
            <p role="alert" className="text-xs font-semibold text-ui-danger">
              {error}
            </p>
          ) : null}
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Owner sign-in"
      description={`You're viewing this world. To play and change settings, sign in with ${TOKEN_HINT}.`}
    >
      <form
        className="flex flex-col gap-3 rounded-[1rem] bg-ui-ground p-4 inset-ring inset-ring-ui-line"
        onSubmit={(event) => {
          event.preventDefault();
          if (!token.trim() || busy) return;
          setBusy(true);
          setError(undefined);
          void sendOwner("POST", token).then(
            () => window.location.reload(),
            (err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setBusy(false);
            },
          );
        }}
      >
        <PasswordField
          label="Owner Gateway token"
          autoComplete="current-password"
          placeholder="Paste Gateway token"
          value={token}
          disabled={busy}
          error={error}
          onValueChange={(next) => {
            setToken(next);
            setError(undefined);
          }}
        />
        <div>
          <Button
            type="submit"
            tone="primary"
            size="sm"
            pending={busy}
            disabled={!token.trim()}
          >
            Sign in
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

export function ConnectionSettings() {
  const status = useRealtimeStore((state) => state.status);
  const { reachable, backendError, retryBackend } = useSources();
  const { isLocal } = useAccess();
  const { data } = useSWR<ConnectionInfo>(
    isLocal ? "kazusa/connection" : null,
    fetchConnection,
    { revalidateOnFocus: false },
  );

  const down = !reachable || status === "error";
  const tone: StatusTone = down
    ? "error"
    : status === "open"
      ? "ok"
      : "pending";
  const statusLabel = !reachable
    ? "Can't reach the server"
    : STREAM_LABELS[status];
  const detail =
    !reachable && backendError
      ? backendError.message
      : data?.url
        ? `Proxying through this app to ${data.url}`
        : "Same-origin proxy";

  return (
    <SettingsPage
      title="Connection"
      description="Your browser only talks to this app's proxy, keeping Gateway credentials on the server."
    >
      <SettingsSection title="Status">
        <SettingsGroup>
          <SettingsRow
            icon={<StatusDot tone={tone} />}
            title={<span role="status">{statusLabel}</span>}
            detail={
              <span className="font-[ui-monospace,monospace] text-xs">
                {detail}
              </span>
            }
            action={
              down ? (
                <Button size="sm" tone="soft" onClick={retryBackend}>
                  Retry
                </Button>
              ) : null
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <RemoteGatewaySection />

      <OwnerSignInSection />
    </SettingsPage>
  );
}
