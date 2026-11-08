"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { settingsParsers } from "@/components/views/settings/search-params";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRealtime } from "@/lib/live/realtime-provider";
import { cn } from "@/lib/utils";

const LABELS = {
  open: "Live",
  connecting: "Reconnecting…",
  error: "Offline",
} as const;

/** Gateway SSE health. SSE errors surface only here (UX §11). */
export function ConnectionStatusItem() {
  const { status } = useRealtime();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() =>
              void setParams({ view: "settings", "settings.tab": "connection" })
            }
          />
        }
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status === "open" && "bg-online",
            status === "connecting" &&
              "animate-pulse bg-muted-foreground motion-reduce:animate-none",
            status === "error" && "bg-destructive",
          )}
        />
        <span role="status">{LABELS[status]}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">/kazusa/events</span>
      </TooltipContent>
    </Tooltip>
  );
}
