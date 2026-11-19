"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Where the owner finds the token, said the same way everywhere. */
export const TOKEN_HINT =
  "OPENCLAW_GATEWAY_TOKEN in apps/kazusa/world/.state/.env";

async function send(method: "POST" | "DELETE", token?: string) {
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

/**
 * Signs in as the owner of a public frontend (`npm run public`) with the
 * Gateway token. Everything fetched as a visitor is stale after that, so the
 * page starts over.
 */
export function OwnerSignInForm() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await send("POST", token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) void submit();
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
          aria-describedby={error ? "owner-token-error" : undefined}
          onChange={(event) => {
            setToken(event.target.value);
            setError(undefined);
          }}
          className="h-8 min-w-0 flex-1 sm:max-w-80"
        />
        <Button size="sm" type="submit" disabled={busy || !token.trim()}>
          Sign in
        </Button>
      </form>
      {error ? <FieldError id="owner-token-error">{error}</FieldError> : null}
    </div>
  );
}

export function OwnerSignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            send("DELETE").then(
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
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

/**
 * A public frontend whose world isn't set up yet: setting it up writes keys and
 * downloads worlds onto this machine, so the owner signs in first.
 */
export function OwnerGate() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-xl font-semibold">Sign in to set up Kazusa</h1>
        <p className="text-muted-foreground">
          This Kazusa has no world yet. Its owner sets one up after signing in
          with its Gateway token,{" "}
          <code className="text-foreground">OPENCLAW_GATEWAY_TOKEN</code> in{" "}
          <code className="text-foreground">apps/kazusa/world/.state/.env</code>{" "}
          on the computer running it.
        </p>
        <OwnerSignInForm />
      </div>
    </main>
  );
}
