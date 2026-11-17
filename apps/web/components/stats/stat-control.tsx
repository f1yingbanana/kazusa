"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  statBand,
  statValue,
  type StatDefinition,
  type StatEntry,
  type StatValue,
} from "@kazusa/client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSimTime } from "@/lib/time/sim";

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

/** Who last set it and when, or that it still stands where it started. */
export function statProvenance(entry: StatEntry | undefined): string {
  return entry
    ? `Set ${AUTHORS[entry.by]} at ${formatSimTime(entry.at)}`
    : "Still at its initial value";
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

  const set = async (next: StatValue) => {
    if (!onSet || next === value) return;
    setBusy(true);
    try {
      await onSet(next);
    } catch (error) {
      toast.error(`Couldn't change ${statLabel(stat.name).toLowerCase()}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!onSet) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {stat.kind === "number" && typeof value === "number"
          ? `${statBand(stat, value) ?? ""} ${value}/${stat.max}`.trim()
          : value}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      {stat.kind === "choice" ? (
        <Select
          items={stat.values.map(({ name }) => ({ value: name, label: name }))}
          value={String(value)}
          disabled={busy}
          onValueChange={(next) => next && void set(next)}
        >
          <SelectTrigger size="sm" aria-label={label} className="max-w-40">
            <SelectValue />
          </SelectTrigger>
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
  onSet: (value: number) => Promise<void>;
}) {
  const [typed, setTyped] = useState(String(value));
  const band = statBand(stat, value);
  const within = (next: number) => Math.min(stat.max, Math.max(stat.min, next));
  const commit = () => {
    const next = Number(typed);
    if (typed.trim() === "" || !Number.isFinite(next)) setTyped(String(value));
    else void onSet(within(next));
  };
  /** The arrow keys move what is typed a step; leaving the box saves it. */
  const nudge = (by: number) => {
    const from = Number(typed);
    setTyped(String(within((Number.isFinite(from) ? from : value) + by)));
  };
  return (
    <>
      {band ? (
        <span className="mr-1 truncate text-xs text-muted-foreground">
          {band}
        </span>
      ) : null}
      <Input
        inputMode="decimal"
        aria-label={label}
        className="h-7 w-14 px-1.5 text-center font-mono text-xs tabular-nums"
        value={typed}
        disabled={busy}
        onChange={(event) => setTyped(event.target.value)}
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
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        /{stat.max}
      </span>
    </>
  );
}
