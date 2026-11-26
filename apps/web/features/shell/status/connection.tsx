"use client";

import { TextButton } from "@/ui/button";
import { useAccess } from "@/hooks/use-access";
import {
  useRealtimeStore,
  type ConnectionStatus,
} from "@/lib/live/realtime-state";
import { useOpenSettings } from "../../settings/search-params";
import { STATUS_DANGER } from "./look";

export const CONNECTION: Record<ConnectionStatus, { label: string }> = {
  open: { label: "Live" },
  connecting: { label: "Reconnecting…" },
  error: { label: "Offline" },
};

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      aria-hidden
      data-status={status}
      className="size-2 shrink-0 rounded-full data-[status=connecting]:bg-ui-soft data-[status=error]:bg-ui-danger data-[status=open]:bg-ui-ok motion-safe:data-[status=connecting]:animate-pulse"
    />
  );
}

/**
 * Whether the page is hearing from the world, in a word. Out of touch, the
 * owner can open the connection settings from it.
 */
export function ConnectionItem() {
  const status = useRealtimeStore((state) => state.status);
  const { canManage } = useAccess();
  const openSettings = useOpenSettings();
  const text = (
    <>
      <ConnectionDot status={status} />
      <span role="status">{CONNECTION[status].label}</span>
    </>
  );
  if (status === "open" || !canManage)
    return <span className="inline-flex items-center gap-1.5">{text}</span>;
  return (
    <TextButton
      className={`${STATUS_DANGER} gap-1.5`}
      onClick={() => openSettings("connection")}
    >
      {text}
    </TextButton>
  );
}
