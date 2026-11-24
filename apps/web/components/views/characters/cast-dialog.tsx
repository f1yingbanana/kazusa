"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CharacterSummary } from "@kazusa/client";
import { SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useClockAnchor } from "@/hooks/use-clock";
import { useOffstage, useStage } from "@/hooks/use-stage";
import { initials } from "@/lib/format";
import { useLiveStore } from "@/lib/live/state";
import { useSources } from "@/lib/source/provider";
import { matchesQuery } from "@/lib/state/grouping";
import { cn } from "@/lib/utils";

/** What the list starts at: everyone on, everyone off, or as things are. */
export type CastIntent = "onstage" | "offstage" | "choose";

export interface CastRequest {
  /** The group or the character's name; empty for the whole cast. */
  readonly label: string;
  readonly cast: readonly CharacterSummary[];
  readonly intent: CastIntent;
}

/** A row of the list, in pixels. */
const ROW = 44;

/**
 * Who is simulated. Nothing changes until the dialog's button, and it says what
 * the change does in the world and what it costs.
 */
export function CastDialog({
  request,
  onOpenChange,
}: {
  request: CastRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-md">
        {request === null ? null : (
          <ChooseForm
            key={`${request.label}:${request.intent}`}
            request={request}
            onDone={() => onOpenChange(false)}
          />
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

/** Applies the changes; false (and a toast, from `useStage`) on failure. */
function useApply() {
  const { apply } = useStage();
  const [busy, setBusy] = useState(false);
  const run = async (on: readonly string[], off: readonly string[]) => {
    if (!apply) return true;
    setBusy(true);
    const done = (await apply(on, true)) && (await apply(off, false));
    setBusy(false);
    return done;
  };
  return { run, busy };
}

/** Who is being played, as their tag: "You" for the viewer's own. */
function usePlayed(): ReadonlyMap<string, string> {
  const { player, watching } = useSources();
  const statuses = useLiveStore((state) => state.statuses);
  return useMemo(
    () =>
      new Map(
        [...statuses].flatMap(([id, status]) =>
          status.playedBy
            ? [[id, !watching && id === player.id ? "You" : "Played"] as const]
            : [],
        ),
      ),
    [statuses, player.id, watching],
  );
}

function useWaiting(ids: readonly string[]): number {
  return useLiveStore((state) =>
    ids.reduce((sum, id) => sum + (state.statuses.get(id)?.queued ?? 0), 0),
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** What bringing these people on sets off. */
function turnsNote(count: number, waiting: number): string {
  return `${count === 1 ? "They start" : "They all start"} thinking right away${
    waiting > 0
      ? `, reading ${plural(waiting, "waiting message", "waiting messages")} first`
      : ""
  }.`;
}

function PausedNote() {
  const paused = useClockAnchor()?.clock.speed === 0;
  return paused ? (
    <p className="text-sm text-muted-foreground">
      The clock is paused, so nobody acts until it runs again.
    </p>
  ) : null;
}

/**
 * Everyone, as a list to light up: a lit face is onstage. Rows that would
 * change say so. The list keeps its height, so nothing jumps while choosing.
 */
function ChooseForm({
  request,
  onDone,
}: {
  request: CastRequest;
  onDone: () => void;
}) {
  const { label, cast, intent } = request;
  const offstage = useOffstage();
  const played = usePlayed();
  const { run, busy } = useApply();
  // Someone being played stays on: the person playing them decides.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    if (intent === "onstage") return new Set(cast.map((c) => c.id));
    if (intent === "offstage")
      return new Set(cast.filter((c) => played.has(c.id)).map((c) => c.id));
    return new Set(cast.filter((c) => !offstage.has(c.id)).map((c) => c.id));
  });
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => cast.filter((c) => matchesQuery(c, query)),
    [cast, query],
  );

  const comingOn = cast
    .filter((c) => selected.has(c.id) && offstage.has(c.id))
    .map((c) => c.id);
  const goingOff = cast
    .filter((c) => !selected.has(c.id) && !offstage.has(c.id))
    .map((c) => c.id);
  const waiting = useWaiting(comingOn);
  const changes = comingOn.length + goingOff.length;

  const setAll = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const c of shown) {
        if (played.has(c.id)) continue;
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  const toggle = (id: string) => {
    if (played.has(id)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = [
    comingOn.length ? `${comingOn.length} to bring on` : null,
    goingOff.length ? `${goingOff.length} to send off` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {!label
            ? "Who's onstage"
            : cast.length === 1
              ? label
              : `Who's onstage in ${label}`}
        </DialogTitle>
        <DialogDescription>
          Onstage characters think, act and cost tokens. Tap someone to bring
          them on or send them off.
        </DialogDescription>
      </DialogHeader>

      {cast.length > 1 ? (
        <div className="flex items-center gap-1">
          <InputGroup className="h-8 flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${cast.length} characters`}
              aria-label="Search the cast"
            />
          </InputGroup>
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)}>
            None
          </Button>
        </div>
      ) : null}

      <CastList
        size={cast.length}
        cast={shown}
        selected={selected}
        offstage={offstage}
        played={played}
        onToggle={toggle}
      />

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p className="truncate">
          {changes === 0
            ? "No changes yet."
            : `${summary}.${comingOn.length ? ` ${turnsNote(comingOn.length, waiting)}` : ""}`}
        </p>
        <PausedNote />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={busy || changes === 0}
          onClick={async () => {
            if (await run(comingOn, goingOff)) onDone();
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}

/** Virtualized, at a fixed height: the whole cast can be 300. */
function CastList({
  size,
  cast,
  selected,
  offstage,
  played,
  onToggle,
}: {
  /** The whole list's length: the height is set by it, not by the search. */
  size: number;
  cast: readonly CharacterSummary[];
  selected: ReadonlySet<string>;
  offstage: ReadonlySet<string>;
  /** Who plays whom: they can't be sent off from here. */
  played: ReadonlyMap<string, string>;
  onToggle: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cast.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    getItemKey: (index) => cast[index]?.id ?? index,
    overscan: 8,
  });

  return (
    <div
      ref={scrollRef}
      style={{ height: `min(${size * ROW + 10}px, 20rem, 45dvh)` }}
      className="shrink-0 overflow-y-auto rounded-lg border p-1"
    >
      {cast.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nobody matches.
        </p>
      ) : (
        <ul
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtual) => {
            const character = cast[virtual.index];
            const on = selected.has(character.id);
            const changing = on === offstage.has(character.id);
            const playedBy = played.get(character.id);
            return (
              <li
                key={virtual.key}
                className="absolute inset-x-0 top-0"
                style={{
                  height: virtual.size,
                  transform: `translateY(${virtual.start}px)`,
                }}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-disabled={playedBy ? true : undefined}
                  onClick={() => onToggle(character.id)}
                  className="flex size-full items-center gap-3 rounded-md px-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
                >
                  <Avatar
                    className={cn(
                      "size-8 transition-[filter,opacity]",
                      !on && "opacity-40 grayscale",
                    )}
                  >
                    {character.avatarUrl ? (
                      <AvatarImage src={character.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-xs">
                      {initials(character.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      !on && "text-muted-foreground",
                    )}
                  >
                    {character.name}
                  </span>
                  {playedBy ? (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {playedBy}
                    </span>
                  ) : changing ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        on
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {on ? "Onstage" : "Offstage"}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
