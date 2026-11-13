"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useEffect } from "react";
import { toast } from "sonner";
import { settingsParsers } from "@/components/views/settings/search-params";
import { useLiveTemplateDownload } from "@/hooks/use-world-downloads";
import {
  offered,
  useWorldCheck,
  useWorldUpdate,
} from "@/hooks/use-world-update";
import { formatBytes } from "@/lib/format";
import { useSources } from "@/lib/source/provider";

/** What was last announced, so each is announced once per browser. */
const SEEN_KEY = "kazusa.world-update.seen";

function seen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(what: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, what);
  } catch {
    // Announced again next time; harmless.
  }
}

/**
 * Says once that a new version of the world is out, for whoever may download it
 * (`useWorldCheck`), with a button to Settings → Updates, where they see what
 * it changes and how big it is before downloading. Once downloaded, says once
 * that the system agent can bring it in, with a button that asks them.
 */
export function WorldUpdateNotice() {
  const { world } = useSources();
  const { update, admin, known, canAsk, ask } = useWorldUpdate();
  const { enabled, result } = useWorldCheck();
  // The download ends: the world says it's ready without a reload.
  useLiveTemplateDownload(enabled, 5000);
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });
  const name = world?.package?.name ?? "Your world";
  const out = enabled && offered(result) ? result?.latest : undefined;
  const ready = canAsk && known ? update?.version : undefined;

  useEffect(() => {
    if (!out || seen() === `out:${out}` || seen() === `ready:${out}`) return;
    markSeen(`out:${out}`);
    const size = result?.size;
    toast(`${name} ${out} is out`, {
      description: `${size ? `${formatBytes(size)} to download. ` : ""}${admin} can bring it into your world once it’s downloaded, keeping everything that happened in it.`,
      duration: 20_000,
      action: {
        label: "View update",
        onClick: () =>
          void setParams({ view: "settings", "settings.tab": "updates" }),
      },
    });
    // Once per version: the names and setters change identity, not meaning.
  }, [out]);

  useEffect(() => {
    if (!ready || seen() === `ready:${ready}`) return;
    markSeen(`ready:${ready}`);
    toast(`${name} ${ready} is ready`, {
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
  }, [ready]);

  return null;
}
