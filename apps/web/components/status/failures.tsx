"use client";

import { useQueryState } from "nuqs";
import { entityRefParser } from "@/lib/state/entity-ref";
import { useShallow } from "zustand/react/shallow";
import { CircleAlertIcon } from "lucide-react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCharacters } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";

const LISTED = 20;

/**
 * Failures the viewer cleared, as the failure timestamp per character. Only
 * that exact failure stays hidden; a later one for the same character shows.
 */
const useDismissed = create<{
  readonly at: Readonly<Record<string, number>>;
  readonly dismiss: (failures: Readonly<Record<string, number>>) => void;
}>()(
  persist(
    (set) => ({
      at: {},
      dismiss: (failures) =>
        set((state) => ({ at: { ...state.at, ...failures } })),
    }),
    { name: "kazusa:dismissed-failures" },
  ),
);

/**
 * Who is stuck on a failed run, since a world-wide cause fails everyone at
 * once.
 */
export function FailuresItem() {
  const { byId } = useCharacters();
  const [, setSelection] = useQueryState("sel", entityRefParser);
  const dismissed = useDismissed((state) => state.at);
  const dismiss = useDismissed((state) => state.dismiss);
  const failures = useLiveStore(
    useShallow(
      (state) =>
        new Map(
          [...state.statuses].flatMap(([id, status]) =>
            status.failure && status.brain !== "thinking"
              ? [[id, status.failure] as const]
              : [],
          ),
        ),
    ),
  );
  const failing = [...failures].filter(
    ([id, failure]) => (dismissed[id] ?? -Infinity) < failure.at,
  );
  if (failing.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-sm px-1 text-destructive focus-visible:outline-2 focus-visible:outline-ring">
        <CircleAlertIcon aria-hidden className="size-3" />
        {`${failing.length} failed`}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-96">
        <DropdownMenuGroup>
          <div className="flex items-center justify-between pr-1">
            <DropdownMenuLabel>Latest turn failed</DropdownMenuLabel>
            <button
              type="button"
              className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() =>
                dismiss(
                  Object.fromEntries(
                    failing.map(([id, failure]) => [id, failure.at]),
                  ),
                )
              }
            >
              Clear all
            </button>
          </div>
          <DropdownMenuSeparator />
          {failing.slice(0, LISTED).map(([id, { error }]) => (
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
