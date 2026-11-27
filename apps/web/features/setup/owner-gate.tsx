"use client";

import { useState } from "react";
import { Button } from "@/ui/button";
import { PasswordField } from "@/ui/field";
import { SetupFrame } from "./setup-frame";

async function postOwnerToken(token: string) {
  const response = await fetch("/owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  if (response?.ok) return;
  const body = (await response?.json().catch(() => null)) as {
    error?: string;
  } | null;
  throw new Error(body?.error ?? "Couldn't reach Kazusa. Try again.");
}

/**
 * A public frontend whose world isn't set up yet: setting it up writes keys and
 * downloads worlds onto this machine, so the owner signs in first.
 */
export function OwnerGate() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await postOwnerToken(token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <SetupFrame>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
          Sign in to set up Kazusa
        </h1>
        <p className="text-sm leading-relaxed text-pretty text-ui-soft">
          This Kazusa has no world yet. Its owner sets one up after signing in
          with its Gateway token,{" "}
          <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
            OPENCLAW_GATEWAY_TOKEN
          </code>{" "}
          in{" "}
          <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
            apps/kazusa/world/.state/.env
          </code>{" "}
          on the computer running it.
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PasswordField
          label="Gateway token"
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
            pending={busy}
            disabled={!token.trim()}
          >
            Sign in
          </Button>
        </div>
      </form>
    </SetupFrame>
  );
}
