"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useMemo, useState } from "react";
import { useClockAnchor } from "@/hooks/use-clock";
import { useOffstage, useStage } from "@/hooks/use-stage";
import { usePageName } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { useLiveStore } from "@/lib/live/state";
import { groupByNearest, matchesQuery } from "@/lib/state/grouping";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { CheckList, CheckRow } from "@/ui/checkbox";
import {
  AlertDialog,
  AlertPanel,
  Dialog,
  DialogClose,
  DialogPanel,
} from "@/ui/dialog";
import { SearchInput } from "@/ui/input";
import { Note } from "@/ui/note";

/** What the list starts at: everyone on, everyone off, or as things are. */
export type StageIntent = "onstage" | "offstage" | "choose";

export interface StageRequest {
  /** The group's or the character's name; empty for the whole cast. */
  readonly label: string;
  readonly cast: readonly CharacterSummary[];
  readonly intent: StageIntent;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Who is being played: they stay on, the person playing them decides. */
function usePlayed(): ReadonlySet<string> {
  const statuses = useLiveStore((state) => state.statuses);
  return useMemo(
    () =>
      new Set(
        [...statuses].flatMap(([id, status]) => (status.playedBy ? [id] : [])),
      ),
    [statuses],
  );
}

function useWaiting(ids: readonly string[]): number {
  return useLiveStore((state) =>
    ids.reduce((sum, id) => sum + (state.statuses.get(id)?.queued ?? 0), 0),
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

/** What stepping on sets off, and that a paused clock holds it. */
function useOnNote(count: number, waiting: number): string {
  const paused = useClockAnchor()?.clock.speed === 0;
  if (count === 0) return "";
  const start = paused
    ? `${count === 1 ? "They start" : "They all start"} thinking once the clock runs`
    : `${count === 1 ? "They start" : "They all start"} thinking right away`;
  return `${start}${waiting > 0 ? `, reading ${plural(waiting, "waiting message", "waiting messages")} first` : ""}.`;
}

/**
 * Who is simulated: onstage characters think, act and spend tokens. One person
 * gets a plain question; a group or the whole cast a list of faces by group,
 * each group ticked whole or in part. Nothing changes until the button, which
 * says how many will.
 */
export function StageDialog({
  request,
  onOpenChange,
}: {
  request: StageRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const one = request?.cast.length === 1 ? request.cast[0] : undefined;
  return (
    <>
      <AlertDialog
        open={Boolean(request && one)}
        onOpenChange={(open) => !open && onOpenChange(false)}
      >
        {request && one ? (
          <StageOne key={one.id} character={one} intent={request.intent} />
        ) : null}
      </AlertDialog>
      <Dialog
        open={Boolean(request && !one)}
        onOpenChange={(open) => {
          if (!open && !busy) onOpenChange(false);
        }}
      >
        {request && !one ? (
          <StageMany
            key={`${request.label}:${request.intent}`}
            request={request}
            busy={busy}
            setBusy={setBusy}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function StageOne({
  character,
  intent,
}: {
  character: CharacterSummary;
  intent: StageIntent;
}) {
  const offstage = useOffstage();
  const on =
    intent === "choose" ? offstage.has(character.id) : intent === "onstage";
  const { run } = useApply();
  const waiting = useWaiting([character.id]);
  const note = useOnNote(1, waiting);
  const name = firstName(character.name);
  return on ? (
    <AlertPanel
      title={`Make ${name} active?`}
      description={`${name} starts thinking and acting again. ${note}`}
      onConfirm={() => void run([character.id], [])}
    />
  ) : (
    <AlertPanel
      title={`Make ${name} inactive?`}
      description={`${name} stops thinking and acting. Anything sent to them waits for when they become active again.`}
      onConfirm={() => void run([], [character.id])}
    />
  );
}

function StageMany({
  request,
  busy,
  setBusy,
  onDone,
}: {
  request: StageRequest;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const { label, cast, intent } = request;
  const offstage = useOffstage();
  const played = usePlayed();
  const pageName = usePageName();
  const { apply } = useStage();
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
  const groups = useMemo(
    () => (label ? [] : groupByNearest(shown, pageName)),
    [label, shown, pageName],
  );

  const comingOn = cast
    .filter((c) => selected.has(c.id) && offstage.has(c.id))
    .map((c) => c.id);
  const goingOff = cast
    .filter(
      (c) => !selected.has(c.id) && !offstage.has(c.id) && !played.has(c.id),
    )
    .map((c) => c.id);
  const waiting = useWaiting(comingOn);
  const onNote = useOnNote(comingOn.length, waiting);
  const changes = comingOn.length + goingOff.length;

  /** Sets who of `members` is on to `on`, leaving the played as they are. */
  const setFor = (
    members: readonly CharacterSummary[],
    on: ReadonlySet<string>,
  ) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const c of members) {
        if (played.has(c.id)) continue;
        if (on.has(c.id)) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });

  const rows = (members: readonly CharacterSummary[]) =>
    members.map((c) => {
      const on = selected.has(c.id);
      const changing = on === offstage.has(c.id);
      return (
        <CheckRow
          key={c.id}
          value={c.id}
          disabled={played.has(c.id)}
          media={
            <span
              className={
                on
                  ? "transition-[filter,opacity]"
                  : "opacity-45 grayscale transition-[filter,opacity]"
              }
            >
              <Avatar name={c.name} src={c.avatarUrl} size="sm" decorative />
            </span>
          }
          label={c.name}
          hint={
            played.has(c.id) ? (
              "Played"
            ) : changing ? (
              <span className={on ? "text-ui-accent-ink" : undefined}>
                {on ? "Steps on" : "Steps off"}
              </span>
            ) : undefined
          }
        />
      );
    });

  const section = (
    key: string,
    title: string,
    members: readonly CharacterSummary[],
  ) => {
    const free = members.filter((c) => !played.has(c.id)).map((c) => c.id);
    const on = members.filter((c) => selected.has(c.id)).length;
    return (
      <CheckList<string>
        key={key}
        label={title}
        allValues={free}
        value={members.filter((c) => selected.has(c.id)).map((c) => c.id)}
        onValueChange={(next) => setFor(members, new Set(next))}
        className="gap-0"
      >
        <CheckRow
          parent
          disabled={free.length === 0}
          label={<span className="font-extrabold">{title}</span>}
          hint={`${on} of ${members.length}`}
        />
        <div className="flex flex-col ps-4">{rows(members)}</div>
      </CheckList>
    );
  };

  const summary = [
    comingOn.length ? `${comingOn.length} active` : null,
    goingOff.length ? `${goingOff.length} inactive` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <DialogPanel
      title={"Who's active"}
      description="Active characters think, act and spend tokens. Inactive characters are frozen until made active again."
      className="sm:h-[min(40rem,90dvh)]"
      full
      footer={
        <>
          <DialogClose render={<Button tone="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            tone="primary"
            disabled={changes === 0}
            pending={busy}
            onClick={async () => {
              if (!apply) {
                onDone();
                return;
              }
              setBusy(true);
              try {
                if (
                  (await apply(comingOn, true)) &&
                  (await apply(goingOff, false))
                )
                  onDone();
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="flex flex-none items-center gap-1">
        <SearchInput
          aria-label="Search the cast"
          placeholder={`Search ${cast.length} characters`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="bg-ui-ground"
        />
        <Button
          tone="ghost"
          size="sm"
          onClick={() => setFor(shown, new Set(shown.map((c) => c.id)))}
        >
          All
        </Button>
        <Button tone="ghost" size="sm" onClick={() => setFor(shown, new Set())}>
          None
        </Button>
      </div>

      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2">
        {shown.length === 0 ? (
          <Note>Nobody by that name.</Note>
        ) : label ? (
          section(label, label, shown)
        ) : (
          groups.map((group) => section(group.key, group.label, group.members))
        )}
      </div>

      <p className="flex-none text-[0.8125rem] leading-normal text-pretty text-ui-soft">
        {changes === 0 ? "Tick who should be active." : `${summary}. ${onNote}`}
      </p>
    </DialogPanel>
  );
}
