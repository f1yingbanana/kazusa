import { positionAt, type LocationRecord } from "./location.ts";

/** A moment where `observer` could notice `subject` at a place. */
export interface Crossing {
  readonly observer: string;
  readonly subject: string;
  readonly placeId: string;
  /** Sim ms. Who is passing and where they head is read when it happens. */
  readonly at: number;
  /**
   * Set when they meet on the way between `placeId` and this place, going
   * opposite ways; `placeId` is the end they are nearer.
   */
  readonly between?: string;
}

interface Pass {
  readonly placeId: string;
  readonly at: number;
}

/**
 * The places a trip passes through after `now`: neither where it starts (that
 * is leaving) nor where it ends (arriving is a line in that place's room).
 */
function passes(record: LocationRecord, now: number): Pass[] {
  const legs = record.trip?.legs ?? [];
  return legs.slice(1, -1).filter((leg) => leg.at > now);
}

/** One stretch of a trip, between two places on its route. */
interface Stretch {
  readonly from: Pass;
  readonly to: Pass;
}

/** The stretches of a trip still to walk, or being walked, after `now`. */
function stretches(record: LocationRecord, now: number): Stretch[] {
  const legs = record.trip?.legs ?? [];
  return legs
    .slice(1)
    .flatMap((to, index) => (to.at > now ? [{ from: legs[index], to }] : []));
}

/**
 * When two people walking one stretch in opposite directions meet: each moves
 * at a steady pace, so they meet where their shares of it add up to the whole.
 * Undefined when they are never on it at the same time.
 */
function meeting(
  mine: Stretch,
  theirs: Stretch,
  now: number,
): { readonly at: number; readonly share: number } | undefined {
  const a = mine.to.at - mine.from.at;
  const b = theirs.to.at - theirs.from.at;
  // An instant stretch is a place, which passing already covers.
  if (a <= 0 || b <= 0) return undefined;
  const at = Math.round(
    (a * b + mine.from.at * b + theirs.from.at * a) / (a + b),
  );
  if (
    at <= now ||
    at < Math.max(mine.from.at, theirs.from.at) ||
    at > Math.min(mine.to.at, theirs.to.at)
  ) {
    return undefined;
  }
  return { at, share: (at - mine.from.at) / a };
}

/** Whether a record has someone standing at `placeId` at `at`. */
function standsAt(record: LocationRecord, placeId: string, at: number) {
  const position = positionAt(record, at);
  return position.kind === "at" && position.placeId === placeId;
}

/**
 * Every future moment two people's plans cross, both ways round: one passes
 * where the other is, both pass the same place within `windowMs`, or they meet
 * coming opposite ways along one stretch. Each observer is judged separately
 * later, so noticing can be one-sided.
 */
export function crossings(
  a: { readonly id: string; readonly record: LocationRecord },
  b: { readonly id: string; readonly record: LocationRecord },
  now: number,
  windowMs: number,
): Crossing[] {
  const found: Crossing[] = [];
  const both = (placeId: string, at: number): void => {
    found.push(
      { observer: a.id, subject: b.id, placeId, at },
      { observer: b.id, subject: a.id, placeId, at },
    );
  };
  // Coming the other way along the same stretch: the commute's usual meeting.
  const meetings: Crossing[] = [];
  for (const mine of stretches(a.record, now)) {
    for (const theirs of stretches(b.record, now)) {
      if (
        mine.from.placeId !== theirs.to.placeId ||
        mine.to.placeId !== theirs.from.placeId
      ) {
        continue;
      }
      const met = meeting(mine, theirs, now);
      if (!met) continue;
      const [placeId, between] =
        met.share <= 0.5
          ? [mine.from.placeId, mine.to.placeId]
          : [mine.to.placeId, mine.from.placeId];
      meetings.push(
        { observer: a.id, subject: b.id, placeId, at: met.at, between },
        { observer: b.id, subject: a.id, placeId, at: met.at, between },
      );
    }
  }
  found.push(...meetings);
  /** Already seen meeting on the way there, about then. */
  const met = (placeId: string, at: number): boolean =>
    meetings.some(
      (meeting) =>
        (meeting.placeId === placeId || meeting.between === placeId) &&
        Math.abs(meeting.at - at) <= windowMs,
    );

  const aPasses = passes(a.record, now);
  const bPasses = passes(b.record, now);
  for (const pass of aPasses) {
    if (standsAt(b.record, pass.placeId, pass.at)) {
      both(pass.placeId, pass.at);
    }
  }
  for (const pass of bPasses) {
    if (standsAt(a.record, pass.placeId, pass.at)) {
      both(pass.placeId, pass.at);
    }
  }
  for (const mine of aPasses) {
    for (const theirs of bPasses) {
      if (
        mine.placeId === theirs.placeId &&
        Math.abs(mine.at - theirs.at) <= windowMs &&
        !met(mine.placeId, Math.max(mine.at, theirs.at))
      ) {
        both(mine.placeId, Math.max(mine.at, theirs.at));
      }
    }
  }
  return found;
}
