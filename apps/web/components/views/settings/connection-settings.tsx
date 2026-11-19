"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/hooks/use-access";
import { postJson, request } from "@/lib/source/http";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { useSources } from "@/lib/source/provider";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

const STREAM_LABELS = {
  open: "Connected",
  connecting: "Reconnecting…",
  error: "Offline",
} as const;

function GatewayStatus() {
  const status = useRealtimeStore((state) => state.status);
  const { reachable, backendError, retryBackend } = useSources();
  const down = !reachable || status === "error";

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          down
            ? "bg-destructive"
            : status === "open"
              ? "bg-online"
              : "animate-pulse bg-muted-foreground motion-reduce:animate-none",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span role="status" className="text-sm font-medium">
          {!reachable ? "Can't reach the server" : STREAM_LABELS[status]}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {!reachable && backendError ? backendError.message : "Same origin"}
        </span>
      </div>
      {down ? (
        <Button size="sm" variant="outline" onClick={retryBackend}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * On a public server, the owner signs in with the Gateway token. Every view
 * fetched as a visitor is stale after that, so the page starts over.
 */
function OwnerSignIn() {
  const { access, isOwner } = useAccess();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!access.signIn) return null;

  async function run(send: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await send();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (isOwner)
    return (
      <SettingsSection
        title="Owner"
        description="This browser is signed in as the owner."
      >
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => request("/owner", { method: "DELETE" }))}
          >
            Sign out
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </SettingsSection>
    );

  return (
    <SettingsSection
      title="Owner"
      description="You're viewing this world. To play and change it, sign in with its Gateway token, OPENCLAW_GATEWAY_TOKEN in apps/kazusa/world/.state/.env."
    >
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) void run(() => postJson("/owner", { token }));
        }}
      >
        <label htmlFor="owner-token" className="sr-only">
          Gateway token
        </label>
        <Input
          id="owner-token"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          placeholder="Gateway token"
          value={token}
          disabled={busy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setToken(event.target.value)}
          className="h-8 min-w-0 flex-1 sm:max-w-80"
        />
        <Button size="sm" type="submit" disabled={busy || !token.trim()}>
          Sign in
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}

/**
 * The Gateway's health. The browser only ever talks to this app's proxy, which
 * holds the Gateway credential on the server.
 */
export function ConnectionSettings() {
  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Gateway"
        description="The client talks to your Kazusa server through this app's proxy."
      >
        <GatewayStatus />
      </SettingsSection>
      <OwnerSignIn />
    </div>
  );
}
