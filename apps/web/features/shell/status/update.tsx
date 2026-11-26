"use client";

import { TextButton } from "@/ui/button";
import { CircleArrowUpIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAnnouncedRelease } from "@/hooks/use-update";
import {
  dismissUpdate,
  useDismissedUpdateVersion,
} from "@/lib/state/preferences-store";
import { toast } from "@/ui/toast";
import { useOpenSettings } from "../../settings/search-params";
import { STATUS_LINK } from "./look";

/**
 * A newer Kazusa, once its downloads are up: a notice that stays until it's
 * dismissed, and this item until Kazusa is updated. Both open Settings →
 * Updates, which installs it.
 */
export function useKazusaUpdate() {
  const release = useAnnouncedRelease();
  const dismissed = useDismissedUpdateVersion();
  const openSettings = useOpenSettings();
  const version = release?.version;
  const shown = useRef<string | null>(null);
  const open = () => openSettings("updates");
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const id = version ? `update:${version}` : null;
    // Installed from another page, or superseded by a newer release.
    if (shown.current && shown.current !== id) {
      toast.dismiss(shown.current);
      shown.current = null;
    }
    if (!version || !id || dismissed === version) return;
    shown.current = id;
    toast.info(`Kazusa ${version} is available`, {
      id,
      description: "Updating restarts Kazusa. Your world stays as it is.",
      duration: Infinity,
      action: {
        label: "View update",
        onAction: () => {
          dismissUpdate(version);
          openRef.current();
        },
      },
      onDismiss: () => dismissUpdate(version),
    });
  }, [version, dismissed]);

  return { version, open };
}

export function UpdateItem() {
  const { version, open } = useKazusaUpdate();
  if (!version) return null;
  return (
    <TextButton className={STATUS_LINK} onClick={open}>
      <CircleArrowUpIcon aria-hidden />
      {`Update to ${version}`}
    </TextButton>
  );
}
