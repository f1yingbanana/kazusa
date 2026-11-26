"use client";

import {
  statBand,
  statValue,
  type StatDefinition,
  type StatEntry,
  type StatValue,
} from "@kazusa/client";
import { useState } from "react";
import { formatSimTime } from "@/lib/time/sim";
import { TextInput } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select";
import { toast } from "@/ui/toast";

/** `warmth_level` as a person reads it. */
export function statLabel(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const AUTHORS: Record<StatEntry["by"], string> = {
  character: "by the character",
  reviewed: "by their night's sleep",
  user: "by you",
  system: "by the system agent",
};

/** Who last set it and when; nothing while nobody has. */
export function statProvenance(
  entry: StatEntry | undefined,
): string | undefined {
  return entry
    ? `Set ${AUTHORS[entry.by]} at ${formatSimTime(entry.at)}`
    : undefined;
}

/**
 * One state's value with the control that changes it: a picker for a choice, a
 * box to type in for a number. Read-only when `onSet` is absent.
 */
export function StatControl({
  stat,
  entry,
  onSet,
  label,
}: {
  stat: StatDefinition;
  entry: StatEntry | undefined;
  onSet?: (value: StatValue) => Promise<void>;
  /** What the control changes, for assistive technology. */
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const value = statValue(stat, entry);

  /** Whether the value now stands as asked. */
  const set = async (next: StatValue): Promise<boolean> => {
    if (!onSet || next === value) return true;
    setBusy(true);
    try {
      await onSet(next);
      return true;
    } catch (error) {
      toast.error(`Couldn't change ${statLabel(stat.name).toLowerCase()}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!onSet) {
    return (
      <span className="shrink-0 text-xs font-bold text-ui-soft">
        {stat.kind === "number" && typeof value === "number" ? (
          <>
            {statBand(stat, value) ? `${statBand(stat, value)} ` : ""}
            <span className="tabular-nums">{`${value}/${stat.max}`}</span>
          </>
        ) : (
          value
        )}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
      {stat.kind === "choice" ? (
        <Select
          value={String(value)}
          disabled={busy}
          onValueChange={(next) => next && void set(next)}
        >
          <SelectTrigger
            aria-label={label}
            className="h-8 max-w-40 gap-1.5 px-3 text-xs"
          />
          <SelectContent>
            {stat.values.map((option) => (
              <SelectItem key={option.name} value={option.name}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <NumberControl
          // A change from elsewhere replaces what was typed.
          key={String(value)}
          stat={stat}
          value={Number(value)}
          busy={busy}
          label={label}
          onSet={set}
        />
      )}
    </div>
  );
}

function NumberControl({
  stat,
  value,
  busy,
  label,
  onSet,
}: {
  stat: Extract<StatDefinition, { kind: "number" }>;
  value: number;
  busy: boolean;
  label: string;
  onSet: (value: number) => Promise<boolean>;
}) {
  const [typed, setTyped] = useState(String(value));
  const band = statBand(stat, value);
  const within = (next: number) => Math.min(stat.max, Math.max(stat.min, next));
  /** The box shows what was asked for, then what stands if that failed. */
  const commit = () => {
    const next = Number(typed);
    if (typed.trim() === "" || !Number.isFinite(next)) {
      setTyped(String(value));
      return;
    }
    const asked = within(next);
    setTyped(String(asked));
    void onSet(asked).then((saved) => {
      if (!saved) setTyped(String(value));
    });
  };
  /** The arrow keys move what is typed a step; leaving the box saves it. */
  const nudge = (by: number) => {
    const from = Number(typed);
    setTyped(String(within((Number.isFinite(from) ? from : value) + by)));
  };
  return (
    <>
      {band ? (
        <span className="truncate text-xs text-ui-soft">{band}</span>
      ) : null}
      <TextInput
        inputMode="decimal"
        aria-label={label}
        className="h-8 w-14 px-1.5 text-center text-xs tabular-nums"
        value={typed}
        disabled={busy}
        onValueChange={setTyped}
        onBlur={commit}
        onKeyDown={(event) => {
          const step = stat.step ?? 1;
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") setTyped(String(value));
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            nudge(event.key === "ArrowUp" ? step : -step);
          }
        }}
      />
      <span className="text-xs text-ui-soft tabular-nums">/{stat.max}</span>
    </>
  );
}
