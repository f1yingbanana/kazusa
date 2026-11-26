"use client";

import { ChevronUpIcon, CircleAlertIcon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useLiveStore } from "@/lib/live/state";
import { Button } from "@/ui/button";
import { ListRow, ListRows } from "@/ui/list";
import {
  Popover,
  PopoverContent,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { STATUS_DANGER } from "./look";

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

/** Whose latest turn failed and wasn't cleared, with why. */
export function useFailures() {
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
  return {
    failing,
    clear: () =>
      dismiss(
        Object.fromEntries(failing.map(([id, failure]) => [id, failure.at])),
      ),
  };
}

export function FailureList({ onPicked }: { onPicked?: () => void }) {
  const { failing, clear } = useFailures();
  const { byId } = useCharacters();
  const [, select] = useSelection();
  return (
    <>
      <PopoverText>
        Their last turn didn't get through, often because the model or its key
        failed. They try again on their next turn.
      </PopoverText>
      <div className="-mx-2">
        <ListRows>
          {failing.slice(0, LISTED).map(([id, { error }]) => (
            <li key={id}>
              <ListRow
                title={byId.get(id)?.name ?? id}
                sub={error}
                onClick={() => {
                  void select({ kind: "character", id });
                  onPicked?.();
                }}
              />
            </li>
          ))}
        </ListRows>
      </div>
      {failing.length > LISTED ? (
        <PopoverText>{`and ${failing.length - LISTED} more`}</PopoverText>
      ) : null}
      <Button tone="soft" size="sm" className="self-end" onClick={clear}>
        Clear all
      </Button>
    </>
  );
}

/**
 * Who is stuck on a failed run, since a world-wide cause fails everyone at
 * once.
 */
export function FailuresItem() {
  const { failing } = useFailures();
  const [open, setOpen] = useState(false);
  if (failing.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={STATUS_DANGER}>
        <CircleAlertIcon aria-hidden />
        {`${failing.length} failed`}
        <ChevronUpIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="max-h-[min(32rem,70dvh)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <PopoverTitle>Latest turn failed</PopoverTitle>
        <FailureList onPicked={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
