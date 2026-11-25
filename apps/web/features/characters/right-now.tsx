"use client";

import type { CharacterSummary, TaskSummary } from "@kazusa/client";
import { FootprintsIcon, MapPinIcon, UsersIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useLocationRecord, usePlaces } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { firstName } from "@/lib/format";
import { placeName, positionAt } from "@/lib/location/places";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { formatSimDuration, formatSimTime, progress } from "@/lib/time/sim";
import { cx } from "@/ui/cx";
import { DetailSection } from "@/ui/detail";
import { Tooltip } from "@/ui/tooltip";
import { CharacterAvatar } from "./character-avatar";

/**
 * What they're doing, where, and with whom: a line each, under one heading.
 * Offstage or never placed, a sentence says so instead.
 */
export function RightNow({
  character,
  company,
}: {
  character: CharacterSummary;
  company: readonly CharacterSummary[];
}) {
  const status = useCharacterStatus(
    character.kind === "agent" ? character.id : undefined,
  );
  const places = usePlaces();
  const record = useLocationRecord(character.id);
  const now = useSimNow();
  const [, select] = useSelection();
  const position = record && now > 0 ? positionAt(record, now) : undefined;
  const task = status?.task;

  const empty =
    status?.onstage === false
      ? status.queued > 0
        ? `Offstage. ${status.queued} waiting for when they're back.`
        : "Offstage: not simulated until they're back."
      : !task && !position
        ? character.kind === "npc"
          ? "Not simulated: no activity or position."
          : character.kind === "agent" && !status
            ? "No status reported yet."
            : "Not placed anywhere yet."
        : null;

  return (
    <DetailSection title="Right now">
      {empty ? (
        <p className="text-[0.8125rem] text-ui-soft">{empty}</p>
      ) : (
        <>
          {task ? <Task task={task} now={now} /> : null}
          {position && places ? (
            position.kind === "traveling" ? (
              <Line
                icon={<FootprintsIcon />}
                trailing={`arrives ${formatSimTime(position.trip.arriveAt)}`}
              >
                <span className="me-1 text-ui-soft">To</span>
                <PlaceLink
                  name={placeName(places, position.trip.to)}
                  onOpen={() =>
                    void select({ kind: "place", id: position.trip.to })
                  }
                />
              </Line>
            ) : (
              <Line
                icon={<MapPinIcon />}
                trailing={
                  position.since > 0
                    ? `${formatSimDuration(Math.max(0, now - position.since))} here`
                    : undefined
                }
              >
                <PlaceLink
                  name={placeName(places, position.placeId)}
                  onOpen={() =>
                    void select({ kind: "place", id: position.placeId })
                  }
                />
              </Line>
            )
          ) : null}
          {company.length ? (
            <Line icon={<UsersIcon />} label="With">
              <ul className="flex flex-wrap gap-1">
                {company.map((m) => (
                  <li key={m.id}>
                    <Tooltip label={m.name} names>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-full bg-ui-tint py-0.5 ps-0.5 pe-2.5 text-[0.8125rem] font-bold hover:inset-ring-2 hover:inset-ring-ui-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
                        onClick={() =>
                          void select({ kind: "character", id: m.id })
                        }
                      >
                        <CharacterAvatar
                          id={m.id}
                          name={m.name}
                          avatarUrl={m.avatarUrl}
                          kind={m.kind}
                          size="sm"
                          decorative
                        />
                        <span>{firstName(m.name)}</span>
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </Line>
          ) : null}
        </>
      )}
    </DetailSection>
  );
}

/** An icon, the value, and an optional time at the end. */
function Line({
  icon,
  label,
  trailing,
  children,
}: {
  icon: ReactNode;
  /** Names the icon for assistive tech, where the value alone doesn't. */
  label?: string;
  trailing?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 text-sm">
      <span
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? "img" : undefined}
        className="flex h-7 shrink-0 items-center text-ui-soft [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="flex min-h-7 min-w-0 flex-1 items-center">{children}</div>
      {trailing ? (
        <span className="flex h-7 shrink-0 items-center text-xs font-semibold text-ui-soft tabular-nums">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

function PlaceLink({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 truncate rounded-[0.375rem] text-start font-bold hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-ui-primary"
    >
      {name}
    </button>
  );
}

/** The task in their words, its time left, and how far along it is. */
function Task({ task, now }: { task: TaskSummary; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = taskIcon(task.type);
  const fraction = now > 0 ? progress(task.startedAt, task.endAt, now) : 0;
  const span = `${formatSimTime(task.startedAt)}–${formatSimTime(task.endAt)}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Line
        icon={<Icon />}
        label={taskLabel(task.type)}
        trailing={
          now > 0 && task.endAt > now
            ? `${formatSimDuration(task.endAt - now)} left`
            : "Due"
        }
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cx(
            "py-1 text-start leading-snug font-semibold text-pretty outline-none focus-visible:outline-2 focus-visible:outline-ui-primary",
            !expanded && "line-clamp-2",
          )}
        >
          {task.description}
        </button>
      </Line>
      <div
        className="ms-6.5 h-1 overflow-hidden rounded-full bg-ui-tint"
        role="progressbar"
        aria-label={`Task progress, ${span}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div
          className="h-full rounded-full bg-ui-primary transition-[width] duration-700 motion-reduce:transition-none"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
