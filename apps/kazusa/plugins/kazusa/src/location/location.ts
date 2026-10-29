import { formatSimTime } from "../context-engine/format.ts";
import { personLabel } from "../person-label.ts";
import type { ActiveTask, TaskTransition } from "../taskman/types.ts";
import {
  describeTravel,
  placeLabel,
  renderTravelTimes,
  resolvePlace,
  routeBetween,
  routesFrom,
  visibleFrom,
  type WorldMap,
} from "./map.ts";

export interface Trip {
  readonly taskId: string;
  /**
   * Set when the trip is a walk over to do something there: what the character
   * came for, and the minutes they meant to spend on it. A trip that is the
   * activity itself has none.
   */
  readonly purpose?: { readonly description: string; readonly minutes: number };
  readonly to: string;
  readonly departAt: number;
  readonly arriveAt: number;
  /** Every place on the route, origin first, with the sim ms it is reached. */
  readonly legs: readonly { readonly placeId: string; readonly at: number }[];
  /** The usual route time, for comparison with the planned one. */
  readonly usualMinutes: number;
}

/** One participant's position in the `"location"` store. */
export interface LocationRecord {
  /** Where they are, or where the current trip started. */
  readonly placeId: string;
  /** Sim ms when they got there. */
  readonly since: number;
  readonly trip?: Trip;
  /** People they have noticed since they got here; cleared when they move. */
  readonly noticed?: readonly string[];
}

export type Position =
  | { readonly kind: "at"; readonly placeId: string; readonly since: number }
  | {
      readonly kind: "traveling";
      readonly from: string;
      readonly trip: Trip;
      /**
       * The place on the route nearest in time: passing, about to reach, or
       * just left.
       */
      readonly near: string;
    };

function nearPlace(trip: Trip, at: number): string {
  let near = trip.legs[0];
  for (const leg of trip.legs) {
    if (Math.abs(leg.at - at) < Math.abs(near.at - at)) near = leg;
  }
  return near.placeId;
}

/** Position as a pure function of sim time. */
export function positionAt(record: LocationRecord, at: number): Position {
  const { trip } = record;
  if (!trip || at < trip.departAt) {
    return { kind: "at", placeId: record.placeId, since: record.since };
  }
  if (at >= trip.arriveAt) {
    return { kind: "at", placeId: trip.to, since: trip.arriveAt };
  }
  return {
    kind: "traveling",
    from: record.placeId,
    trip,
    near: nearPlace(trip, at),
  };
}

export interface Arrival {
  readonly record: LocationRecord;
  /** The arrival check-in's line: where they are and what they came for. */
  readonly note: string;
}

/**
 * A finished trip, settled at its end. Nothing is judged: whether the door
 * opens is the character's to play out from what they know of the place, like
 * the rest of the activity. `undefined` if the trip hasn't ended.
 */
export function arrive(
  map: WorldMap,
  record: LocationRecord,
  at: number,
): Arrival | undefined {
  const { trip } = record;
  if (!trip || at < trip.arriveAt) return undefined;
  const came = trip.purpose
    ? ` You came here for "${trip.purpose.description}", planning about ${trip.purpose.minutes} min. Carry on with it, or change your mind.`
    : "";
  return {
    record: { placeId: trip.to, since: trip.arriveAt },
    note: `You've arrived at ${placeLabel(map, trip.to)}.${came}`,
  };
}

/** Where someone stands for a new activity: a trip in progress stops nearby. */
function standing(record: LocationRecord, at: number): LocationRecord {
  const position = positionAt(record, at);
  if (position.kind === "traveling")
    return { placeId: position.near, since: at };
  return { placeId: position.placeId, since: position.since };
}

export interface PlannedMove {
  /** Absent when nothing changes. */
  readonly record?: LocationRecord;
  /** The arrival, when the lease should check in then rather than later. */
  readonly checkInAt?: number;
  readonly note?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

const nameOf = (map: WorldMap, id: string): string =>
  map.places.get(id)?.name ?? id;

/** The usual route's legs, scaled from `departAt` to `arriveAt`. */
function tripTo(
  map: WorldMap,
  params: {
    readonly taskId: string;
    readonly from: string;
    readonly to: string;
    readonly departAt: number;
    /** Absent: the usual pace. */
    readonly arriveAt?: number;
  },
): Trip {
  const route = routeBetween(map, params.from, params.to);
  const { departAt } = params;
  const arriveAt = params.arriveAt ?? departAt + route.minutes * 60_000;
  const span = arriveAt - departAt;
  let elapsed = 0;
  const legs = [{ placeId: params.from, at: departAt }];
  for (const [index, leg] of route.legs.entries()) {
    elapsed += leg.ways[0].minutes;
    legs.push({
      placeId: leg.placeId,
      at:
        index === route.legs.length - 1 || route.minutes === 0
          ? arriveAt
          : departAt + Math.round((span * elapsed) / route.minutes),
    });
  }
  return {
    taskId: params.taskId,
    to: params.to,
    departAt,
    arriveAt,
    legs,
    usualMinutes: route.minutes,
  };
}

/**
 * Where a new activity happens. Nothing is refused: `where` is a place id or
 * name, or the character's own words for a spot where they are. A trip is the
 * activity; anything else elsewhere starts with a walk over at the usual pace.
 * Getting in is the character's to play out on arrival.
 */
export async function planStart(params: {
  readonly map: WorldMap;
  readonly record: LocationRecord | undefined;
  readonly at: number;
  readonly task: ActiveTask;
  readonly where: string;
  readonly travel: boolean;
}): Promise<PlannedMove> {
  const { map, at, task, travel } = params;
  const target = resolvePlace(map, params.where);
  const here = params.record ? standing(params.record, at) : undefined;
  if (!target) {
    const spot = params.where.trim();
    if (!here) {
      return { note: `At ${spot}.`, payload: { spot } };
    }
    // A trip needs a route. Live, Kazusa "walked to Trinity Beach" and was
    // told "At Trinity Beach, in West Annex", so she thought she was there.
    if (travel) {
      return {
        record: here,
        note: `You don't know the way to "${spot}": it isn't anywhere you know how to get to. You're still at ${nameOf(map, here.placeId)}; ask someone, or head for a place you know.`,
        payload: { where: here.placeId, unknown: spot },
      };
    }
    return {
      record: here,
      note: `At ${spot}, in ${nameOf(map, here.placeId)}: somewhere only you have noticed so far.`,
      payload: { where: here.placeId, spot },
    };
  }

  const endAt = Date.parse(task.endAt);
  if (!travel && here && here.placeId !== target.id) {
    // An activity elsewhere starts with the walk there; it has to fit.
    const route = routeBetween(map, here.placeId, target.id);
    if (at + route.minutes * 60_000 >= endAt) {
      throw new Error(
        `Getting from ${nameOf(map, here.placeId)} to ${target.name} usually takes ${describeTravel(route)}, which doesn't fit in this ${Math.round((endAt - at) / 60_000)}-minute activity. Plan it for longer, or make getting there its own trip first.`,
      );
    }
  }

  const notes: string[] = [];
  const payload: Record<string, unknown> = {};
  const destination = target.id;
  payload.where = destination;

  if (!here) {
    notes.push(`At ${nameOf(map, destination)}.`);
    return {
      record: { placeId: destination, since: at },
      note: notes.join(" "),
      payload,
    };
  }
  if (destination === here.placeId) {
    notes.push(`${travel ? "Around" : "At"} ${nameOf(map, destination)}.`);
    return { record: here, note: notes.join(" "), payload };
  }

  const walk = tripTo(map, {
    taskId: task.id,
    from: here.placeId,
    to: destination,
    departAt: at,
    ...(travel ? { arriveAt: endAt } : {}),
  });
  // Walking over to do something: arrival is the check-in, so the one wake
  // of the lease is the moment they get there. It always fits: a walk longer
  // than the activity was refused above.
  const checkIn = !travel;
  const trip: Trip = checkIn
    ? {
        ...walk,
        purpose: {
          description: task.description,
          minutes: Math.round((endAt - walk.arriveAt) / 60_000),
        },
      }
    : walk;
  const usual = describeTravel(routeBetween(map, here.placeId, destination));
  if (travel) {
    notes.push(
      `Traveling from ${nameOf(map, here.placeId)} to ${nameOf(map, destination)} (usually ${usual}); arriving ${formatSimTime(trip.arriveAt)}.`,
    );
  } else {
    notes.push(
      `You walk over from ${nameOf(map, here.placeId)} first (usually ${usual}), arriving ${formatSimTime(trip.arriveAt)}.`,
    );
    notes.push("You'll check in when you get there.");
  }
  return {
    record: { ...here, trip },
    ...(checkIn ? { checkInAt: trip.arriveAt } : {}),
    note: notes.join(" "),
    payload: {
      ...payload,
      from: here.placeId,
      arriveAt: trip.arriveAt,
      usualMinutes: trip.usualMinutes,
    },
  };
}

/** A delayed trip keeps its route; the places not yet reached shift later. */
export function planDelay(params: {
  readonly map: WorldMap;
  readonly record: LocationRecord | undefined;
  readonly at: number;
  readonly task: ActiveTask;
}): PlannedMove {
  const { map, record, at, task } = params;
  const trip = record?.trip;
  if (!record || !trip || trip.taskId !== task.id || at >= trip.arriveAt) {
    return {};
  }
  const arriveAt = Date.parse(task.endAt);
  const stretch = (arriveAt - at) / (trip.arriveAt - at);
  const legs = trip.legs.map((leg, index) => ({
    placeId: leg.placeId,
    at:
      index === trip.legs.length - 1
        ? arriveAt
        : leg.at <= at
          ? leg.at
          : at + Math.round((leg.at - at) * stretch),
  }));
  return {
    record: { ...record, trip: { ...trip, arriveAt, legs } },
    note: `Now arriving at ${nameOf(map, trip.to)} ${formatSimTime(arriveAt)}.`,
    payload: { arriveAt },
  };
}

/** The move a task transition implies, for travel categories `travel`. */
export async function planTransition(
  map: WorldMap,
  record: LocationRecord | undefined,
  transition: TaskTransition,
  where: string,
  travel: readonly string[],
): Promise<PlannedMove> {
  return transition.kind === "delayed"
    ? planDelay({ map, record, at: transition.at, task: transition.task })
    : planStart({
        map,
        record,
        at: transition.at,
        task: transition.task,
        where,
        travel: travel.includes(transition.task.type),
      });
}

/** Someone standing in the same place, as the character sees them. */
export interface Companion {
  readonly id: string;
  readonly name: string;
  /** Their activity's category: what anyone can see them doing. */
  readonly activity?: string;
  /** The conversation they are in here, if any. */
  readonly huddle?: string;
}

/** What the character knows, for `Where you are`. */
export interface PlaceKnowledge {
  /** Places they have a card for in their personal wiki. */
  readonly known: ReadonlySet<string>;
  /** Places named in what they are reading or planning, most relevant first. */
  readonly named: readonly string[];
}

/**
 * The `Where you are` lines: the place, what can be seen from it, and the
 * places on the character's mind, never the whole map. A place they have no
 * card for is new to them, so they take in its whole description.
 */
export function renderWhereabouts(
  map: WorldMap,
  record: LocationRecord | undefined,
  at: number,
  knowledge: PlaceKnowledge,
  limit: number,
  company: readonly Companion[] = [],
  ownHuddle?: string,
): string {
  if (!record) {
    return "You haven't settled anywhere yet; name the place with `where` when you choose your next activity.";
  }
  const position = positionAt(record, at);
  if (position.kind === "traveling") {
    const { trip } = position;
    return `On your way from ${nameOf(map, position.from)} to ${nameOf(map, trip.to)} \`${trip.to}\`; near ${nameOf(map, position.near)} \`${position.near}\` now. Arriving ${formatSimTime(trip.arriveAt)}.`;
  }
  const place = map.places.get(position.placeId);
  if (!place) return `Somewhere unknown (${position.placeId}).`;
  const around = visibleFrom(map, place.id);
  const aroundSet = new Set(around);
  // Named places first, then the nearest places they know.
  const routes = routesFrom(map, place.id);
  const nearest = [...knowledge.known].sort(
    (a, b) =>
      (routes.get(a)?.minutes ?? Infinity) -
        (routes.get(b)?.minutes ?? Infinity) || a.localeCompare(b),
  );
  const onMind = [...new Set([...knowledge.named, ...nearest])]
    .filter((id) => id !== place.id && !aroundSet.has(id) && map.places.has(id))
    .slice(0, limit);
  const lines = [`${placeLabel(map, place.id)}. ${place.summary}`];
  const description = place.bodyMarkdown.replace(/^#[^\n]*\n+/u, "").trim();
  if (!knowledge.known.has(place.id) && description) {
    lines.push(`New to you; you take it all in: ${description}`);
  }
  // Said even when empty: texts like "I'm right outside" otherwise go
  // uncontradicted, and characters act as if the sender were there.
  if (company.length === 0) {
    lines.push("With you: no one you've noticed.");
  } else {
    lines.push(
      `With you: ${company
        .map(({ id, name, activity, huddle }) => {
          const talking =
            huddle === undefined
              ? []
              : [
                  huddle === ownHuddle
                    ? `talking with you, ${huddle}`
                    : `talking, ${huddle}`,
                ];
          const notes = [...(activity ? [activity] : []), ...talking];
          return `${personLabel(name, id)}${notes.length ? ` (${notes.join("; ")})` : ""}`;
        })
        .join(" · ")}`,
    );
  }
  if (around.length > 0) {
    lines.push(
      `Around you: ${renderTravelTimes(map, place.id, around, limit)}`,
    );
  }
  if (onMind.length > 0) {
    lines.push(`Places you know: ${renderTravelTimes(map, place.id, onMind)}`);
  }
  return lines.join("\n");
}
