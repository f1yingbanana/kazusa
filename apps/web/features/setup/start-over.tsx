"use client";

import { useState } from "react";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/settings";
import { SetupFrame } from "./setup-frame";

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
    <SetupFrame>
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
          Start a new world
        </h1>
        <p className="text-sm leading-relaxed text-pretty text-ui-soft">
          Your world was made by an older version of Kazusa, and this version
          can&apos;t run it. Worlds are now downloaded straight from their
          creators, so they can be updated as new versions come out.
        </p>
        <p className="text-sm leading-relaxed text-pretty text-ui-soft">
          Starting a new world keeps your old one in{" "}
          <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
            apps/kazusa/old-worlds
          </code>
          . Nothing in it is deleted.
        </p>
        <p className="text-sm leading-relaxed text-pretty text-ui-soft">
          Your API key stays with the old world, so have it ready: setup asks
          for it again.
        </p>
      </div>
      {error ? (
        <Callout tone="danger" title="Couldn't move the old world">
          {error}
        </Callout>
      ) : null}
      <div>
        <Button
          tone="primary"
          pending={working}
          onClick={() => void startOver()}
        >
          Start a new world
        </Button>
      </div>
    </SetupFrame>
  );
}
