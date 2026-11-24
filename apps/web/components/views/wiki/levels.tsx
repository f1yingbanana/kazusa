"use client";

import type { WikiGroup, WikiLevel, WikiReachResponse } from "@kazusa/client";
import { cn } from "@/lib/utils";
import { PeopleLinks } from "./page-link";

/*
 * Who gets each part of a page, worded once for reading and editing: the
 * summary (heard of), the opening (knows), topics (close), and on a
 * character's own page their inner voice (only them).
 */

export type Audience = "heard" | "knows" | "close" | "self";

/** The group every character is in. */
export const EVERYONE = "everyone";

/** "Anyone who's heard of Yuuka", "Only Yuuka". */
export function audienceLabel(audience: Audience, subject: string): string {
  switch (audience) {
    case "heard":
      return `Anyone who's heard of ${subject}`;
    case "knows":
      return `Anyone who knows ${subject}`;
    case "close":
      return `Anyone who knows ${subject} well`;
    case "self":
      return `Only ${subject}`;
  }
}

/**
 * How well a group knows a page, as its choice reads: "them" for a person, "it"
 * for anything else.
 */
export const levelsFor = (
  person: boolean,
): ReadonlyArray<{ readonly value: WikiLevel; readonly label: string }> => {
  const thing = person ? "them" : "it";
  return [
    { value: "heard of", label: `Heard of ${thing}` },
    { value: "knows", label: `Know ${thing}` },
    { value: "close", label: `Know ${thing} well` },
  ];
};

export const levelLabel = (level: WikiLevel, person: boolean): string =>
  levelsFor(person).find((option) => option.value === level)?.label ?? level;

/** The audience a level reaches. */
export const AUDIENCE_OF: Readonly<Record<WikiLevel, Audience>> = {
  "heard of": "heard",
  knows: "knows",
  close: "close",
};

/** The colour of a part's left edge: the wider its audience, the quieter. */
export const RAIL: Readonly<Record<Audience, string>> = {
  heard: "border-l-border",
  knows: "border-l-primary/35",
  close: "border-l-primary",
  self: "border-l-amber-500",
};

/** The label's colour, matching the rail. */
export const TINT: Readonly<Record<Audience, string>> = {
  heard: "text-muted-foreground",
  knows: "text-primary/80",
  close: "text-primary",
  self: "text-amber-600 dark:text-amber-400",
};

/** Who in the cast is in an audience, as the page now stands: each a link. */
export function peopleIn(
  audience: Audience,
  reach: WikiReachResponse | undefined,
  /** Names only: while editing, a link would leave the edit. */
  plain = false,
): React.ReactNode {
  if (!reach || audience === "self") return undefined;
  const people =
    audience === "close"
      ? reach.well
      : audience === "knows"
        ? [...reach.well, ...reach.knows]
        : [...reach.well, ...reach.knows, ...reach.heard];
  if (!people.length) return "nobody yet";
  return <PeopleLinks people={people} max={6} plain={plain} />;
}

/** A group's name as a page lists it: Everyone, or its page's name. */
export function groupName(
  ref: string,
  nameOf: (ref: string) => string | undefined,
): string {
  return ref.toLowerCase() === EVERYONE ? "Everyone" : (nameOf(ref) ?? ref);
}

/** Everyone first, then the rest as written. */
export const everyoneFirst = (groups: readonly WikiGroup[]): WikiGroup[] => [
  ...groups.filter(({ ref }) => ref.toLowerCase() === EVERYONE),
  ...groups.filter(({ ref }) => ref.toLowerCase() !== EVERYONE),
];

/** The left-edged block one part of a page sits in. */
export function Rail({
  audience,
  label,
  people,
  hint,
  className,
  children,
}: {
  audience: Audience;
  /** The audience, said. */
  label: React.ReactNode;
  /** Who that is now, by name. */
  people?: React.ReactNode;
  /** What the part is for, under the label. */
  hint?: React.ReactNode;
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
        {hint ? (
          <span className="basis-full text-pretty text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
