"use client";

import { Button } from "@/components/ui/button";
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
    </div>
  );
}
