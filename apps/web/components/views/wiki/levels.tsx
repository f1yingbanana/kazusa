"use client";

import type { WikiPageFormFields, WikiReachResponse } from "@kazusa/client";
import { cn } from "@/lib/utils";

/*
 * Who can know each part of a page, said one way wherever a page is read or
 * edited. Kazusa works out how well each character knows a page; a part says
 * which of them it is for:
 *
 * - the summary line, for anyone who has heard of it;
 * - the opening, for anyone who knows it;
 * - a part, for those close to it, when the conversation comes to it;
 * - on a character's own page, a part only they know: their inner voice.
 *
 * A secret only some others know isn't written here: it goes in each of
 * their own wikis, in their own words, where they can forget it or be wrong.
 * An older part naming people (`named`) is still shown as it is.
 */

export type Audience = "heard" | "knows" | "close" | "self" | "named";

/** A part's audience from its `Known by:` line. */
export function audienceOf(
  knownBy: readonly string[],
  self: string | undefined,
): Audience {
  if (!knownBy.length) return "close";
  return self !== undefined && knownBy.length === 1 && knownBy[0] === self
    ? "self"
    : "named";
}

/** "Anyone who knows Yuuka", "Only Hoshino and Shiroko". */
export function audienceLabel(
  audience: Audience,
  subject: string,
  names: readonly string[] = [],
): string {
  switch (audience) {
    case "heard":
      return `Anyone who's heard of ${subject}`;
    case "knows":
      return `Anyone who knows ${subject}`;
    case "close":
      return `Close to ${subject}`;
    case "self":
      return `Only ${subject}`;
    case "named":
      return names.length ? `Only ${listOf(names)}` : "Only certain people";
  }
}

/** The colour of a part's left edge: the wider its audience, the quieter. */
export const RAIL: Readonly<Record<Audience, string>> = {
  heard: "border-l-border",
  knows: "border-l-primary/35",
  close: "border-l-primary",
  self: "border-l-amber-500",
  named: "border-l-amber-500",
};

/** The label's colour, matching the rail. */
export const TINT: Readonly<Record<Audience, string>> = {
  heard: "text-muted-foreground",
  knows: "text-primary/80",
  close: "text-primary",
  self: "text-amber-600 dark:text-amber-400",
  named: "text-amber-600 dark:text-amber-400",
};

/** "Noa, Koyuki and 3 others". */
export function listOf(names: readonly string[], max = 3): string {
  if (names.length <= max)
    return names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : (names[0] ?? "");
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

/** Who in the cast is in an audience, as the page now stands. */
export function peopleIn(
  audience: Audience,
  reach: WikiReachResponse | undefined,
): string | undefined {
  if (!reach) return undefined;
  const names = (list: WikiReachResponse["well"]) =>
    list.map(({ name }) => name);
  const people =
    audience === "close"
      ? names(reach.well)
      : audience === "knows"
        ? [...names(reach.well), ...names(reach.knows)]
        : audience === "heard"
          ? [...names(reach.well), ...names(reach.knows), ...names(reach.heard)]
          : undefined;
  if (!people) return undefined;
  if (!people.length) return "nobody yet";
  return people.length > 6 ? `${people.length} characters` : listOf(people, 6);
}

/** How widely a page is known: its renown, or a secret (`known_by`). */
export type Reach = NonNullable<WikiPageFormFields["renown"]> | "secret";

export const REACH: ReadonlyArray<{
  readonly value: Reach;
  readonly label: string;
  readonly hint: (subject: string) => string;
}> = [
  {
    value: "local",
    label: "Its own groups",
    hint: (subject) =>
      `People in ${subject}'s groups know it; nobody else has heard of it.`,
  },
  {
    value: "known",
    label: "Everyone has heard of it",
    hint: (subject) =>
      `Everyone gets the summary line; people in ${subject}'s groups know it.`,
  },
  {
    value: "famous",
    label: "Everyone knows it",
    hint: () => "Everyone gets the summary line and the opening.",
  },
  {
    value: "private",
    label: "Hidden",
    hint: () =>
      "Only those who live there, or have met it, know it. Nobody else has heard of it.",
  },
  {
    value: "secret",
    label: "Only certain people",
    hint: () =>
      "Only the people named know it. Better written in their own wikis, so it is theirs to forget or get wrong.",
  },
];

/** The left-edged block one part of a page sits in. */
export function Rail({
  audience,
  label,
  people,
  className,
  children,
}: {
  audience: Audience;
  /** The audience, said; a control can stand in for it. */
  label: React.ReactNode;
  /** Who that is now, in names. */
  people?: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("border-l-2 py-1 pl-4", RAIL[audience], className)}>
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={cn("font-medium", TINT[audience])}>{label}</span>
        {people ? (
          <span className="text-muted-foreground">{people}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
