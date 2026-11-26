"use client";

import {
  CoinsIcon,
  FastForwardIcon,
  HeartPulseIcon,
  SaveIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useSaves } from "@/hooks/use-saves";
import { andList } from "@/lib/format";
import { openSavesDialog } from "@/lib/state/ui-store";
import { formatSimDate, formatSimTime, simPhase } from "@/lib/time/sim";
import { Button } from "@/ui/button";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { formatSkip, type Waker } from "./skip";

const NAMED = 4;

function Point({
  icon,
  lead,
  children,
}: {
  icon: ReactNode;
  lead: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 text-sm leading-normal text-pretty [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ui-primary">
      {icon}
      <span className="text-ui-soft">
        <strong className="font-bold text-ui-ink">{lead}</strong> {children}
      </span>
    </li>
  );
}

/** Who wakes, by name while that's short. */
function whoWakes(wakers: readonly Waker[]): string {
  const names = wakers.slice(0, NAMED).map((waker) => waker.name);
  const rest = wakers.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : andList(names);
}

/**
 * Before a big skip: what a jump in time does, in the terms a player weighs it
 * by (what they miss, what it costs, how the characters take it).
 */
export function SkipDialog({
  open,
  onOpenChange,
  minutes,
  landing,
  wakers,
  onSkip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minutes: number;
  landing: number;
  wakers: readonly Waker[];
  onSkip: () => void;
}) {
  const saves = useSaves();
  const n = wakers.length;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertPanel
        size="md"
        title={`Skip ${formatSkip(minutes)}?`}
        description={`The world jumps straight to ${formatSimDate(landing)}, ${formatSimTime(landing)} (${simPhase(landing).toLowerCase()}).`}
        agentConfirm={`Moves the world's clock forward ${formatSkip(minutes)}; it can't be undone`}
        onConfirm={onSkip}
        aside={
          saves.enabled ? (
            <Button
              tone="ghost"
              icon={<SaveIcon aria-hidden />}
              onClick={() => {
                onOpenChange(false);
                openSavesDialog();
              }}
            >
              Save first
            </Button>
          ) : null
        }
      >
        <ul className="flex flex-col gap-3">
          <Point
            icon={<FastForwardIcon aria-hidden />}
            lead="Nothing happens in between."
          >
            No one talks, travels or texts in the skipped time, and nobody is
            told: they just find it's later.
          </Point>
          {n === 0 ? (
            <Point icon={<CoinsIcon aria-hidden />} lead="Little token use.">
              Nobody's plans end by then, so nobody wakes early.
            </Point>
          ) : (
            <Point
              icon={<CoinsIcon aria-hidden />}
              lead="A burst of token use."
            >
              {`${n === 1 ? "1 person" : `${n} people`} (${whoWakes(wakers)}) ${n === 1 ? "finishes" : "finish"} what they were doing and ${n === 1 ? "decides" : "all decide"} what's next at once: a model call each, then more as they answer each other.`}
            </Point>
          )}
          <Point
            icon={<HeartPulseIcon aria-hidden />}
            lead="They feel the hours."
          >
            Their needs move as if they had lived them: hungrier, more tired, or
            missing people more.
          </Point>
          <Point icon={<SaveIcon aria-hidden />} lead="No undo.">
            Save first if you might want to come back to now.
          </Point>
        </ul>
      </AlertPanel>
    </AlertDialog>
  );
}
