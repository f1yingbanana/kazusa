"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { settingsParsers } from "@/components/views/settings/search-params";
import { useCallback, useEffect, useRef } from "react";
import { CircleArrowUpIcon } from "lucide-react";
import { toast } from "sonner";
import { useAnnouncedRelease } from "@/hooks/use-update";

/** The last release whose notice was dismissed, so each is announced once. */
const DISMISSED_KEY = "kazusa:update-dismissed";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function dismiss(version: string) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Without storage it's announced again on the next load.
  }
}

/**
 * A newer release, once its downloads are up: a notice that stays until it's
 * dismissed, and this item until Kazusa is updated. Both open Settings →
 * Updates, which installs it.
 */
export function UpdateAvailableItem() {
  const release = useAnnouncedRelease();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });
  const version = release?.version;
  const shown = useRef<string | null>(null);
  const openUpdates = useCallback(
    () => void setParams({ view: "settings", "settings.tab": "updates" }),
    [setParams],
  );

  useEffect(() => {
    // One id per version: showing it again replaces it, never stacks.
    const id = version ? `update:${version}` : null;
    // Installed from another page, or superseded by a newer release.
    if (shown.current && shown.current !== id) {
      toast.dismiss(shown.current);
      shown.current = null;
    }
    if (!version || !id || dismissedVersion() === version) return;
    shown.current = id;
    toast(`Kazusa ${version} is available`, {
      id,
      description: "Updating restarts Kazusa. Your world stays as it is.",
      icon: <CircleArrowUpIcon className="size-4" />,
      duration: Infinity,
      closeButton: true,
      action: {
        label: "View update",
        onClick: () => {
          dismiss(version);
          openUpdates();
        },
      },
      onDismiss: () => dismiss(version),
    });
  }, [version, openUpdates]);

  if (!version) return null;
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-foreground hover:underline"
      onClick={openUpdates}
    >
      <CircleArrowUpIcon className="size-3" aria-hidden />
      {`Update to ${version}`}
    </button>
  );
}
