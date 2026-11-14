"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

/**
 * What a player sees when Kazusa was updated past the world they had: worlds an
 * older Kazusa made can't run or take updates any more. Starting over sets that
 * world aside (never deletes it) and opens setup (`lib/setup/setup.ts`).
 */
export function StartOver() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOver = async () => {
    setWorking(true);
    setError(null);
    const response = await fetch("/setup/start-over", { method: "POST" }).catch(
      () => null,
    );
    if (response?.ok) {
      window.location.reload();
      return;
    }
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setError(
      body?.error ?? "Couldn't set the world aside. Check the terminal.",
    );
    setWorking(false);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-xl font-semibold">Start a new world</h1>
        <p className="text-muted-foreground">
          Your world was made by an older version of Kazusa, and this version
          can&apos;t run it. Worlds are now downloaded straight from their
          creators, so they can be updated as new versions come out.
        </p>
        <p className="text-muted-foreground">
          Starting a new world keeps your old one in{" "}
          <code className="text-foreground">apps/kazusa/old-worlds</code>.
          Nothing in it is deleted.
        </p>
        <div>
          <Button onClick={() => void startOver()} disabled={working}>
            {working ? "Setting it aside…" : "Start a new world"}
          </Button>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </main>
  );
}
