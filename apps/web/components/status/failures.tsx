"use client";

import { useQueryState } from "nuqs";
import { entityRefParser } from "@/lib/state/entity-ref";
import { useShallow } from "zustand/react/shallow";
import { CircleAlertIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCharacters } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";

const LISTED = 20;

/**
 * Who is stuck on a failed run, since a world-wide cause fails everyone at
 * once.
 */
export function FailuresItem() {
  const { byId } = useCharacters();
  const [, setSelection] = useQueryState("sel", entityRefParser);
  const failures = useLiveStore(
    useShallow(
      (state) =>
        new Map(
          [...state.statuses].flatMap(([id, status]) =>
            status.failure && status.brain !== "thinking"
              ? [[id, status.failure.error] as const]
              : [],
          ),
        ),
    ),
  );
  const failing = [...failures];
  if (failing.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-sm px-1 text-destructive focus-visible:outline-2 focus-visible:outline-ring">
        <CircleAlertIcon aria-hidden className="size-3" />
        {`${failing.length} failed`}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Latest turn failed</DropdownMenuLabel>
          {failing.slice(0, LISTED).map(([id, error]) => (
            <DropdownMenuItem
              key={id}
              className="flex-col items-start gap-0.5"
              onClick={() => void setSelection({ kind: "character", id })}
            >
              <span className="font-medium">{byId.get(id)?.name ?? id}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {error}
              </span>
            </DropdownMenuItem>
          ))}
          {failing.length > LISTED ? (
            <DropdownMenuLabel>{`and ${failing.length - LISTED} more`}</DropdownMenuLabel>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
