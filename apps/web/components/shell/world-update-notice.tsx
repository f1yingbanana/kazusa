"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSources } from "@/lib/source/provider";
import { useLiveTemplateDownload } from "@/hooks/use-world-downloads";
import { useWorldCheck, useWorldUpdate } from "@/hooks/use-world-update";

/** The version last announced, so each one is announced once per browser. */
const SEEN_KEY = "kazusa.world-update.seen";

function seen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(version: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Announced again next time; harmless.
  }
}

/**
 * Says once that a new version of the world is out, with a button that asks the
 * system agent to bring it in. Settings → Updates keeps offering it after.
 */
export function WorldUpdateNotice() {
  const { world } = useSources();
  const { update, admin, known, canAsk, ask } = useWorldUpdate();
  // New versions download as Kazusa starts and hourly after: announce one
  // once it's in, without a reload.
  useWorldCheck();
  useLiveTemplateDownload(canAsk, 5000);
  const version = update?.version;
  const name = world?.package?.name ?? "Your world";

  useEffect(() => {
    if (!version || !canAsk || !known || seen() === version) return;
    markSeen(version);
    toast(`${name} ${version} is out`, {
      description: `${admin} can bring it into your world, keeping everything that happened in it.`,
      duration: 20_000,
      action: {
        label: `Ask ${admin}`,
        onClick: () =>
          void ask().catch((failure: unknown) =>
            toast.error(`Couldn't message ${admin}`, {
              description:
                failure instanceof Error ? failure.message : undefined,
            }),
          ),
      },
    });
    // Once per version: `ask` and the names change identity, not meaning.
  }, [version, canAsk, known]);

  return null;
}
