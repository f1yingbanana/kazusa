import type { CharacterStatus, CharacterSummary } from "@kazusa/client";

/** Name, id or alias contains the words typed. */
export function matchesQuery(character: CharacterSummary, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    character.name.toLowerCase().includes(needle) ||
    character.id.toLowerCase().includes(needle) ||
    character.aliases.some((alias) => alias.toLowerCase().includes(needle))
  );
}

export interface Group {
  readonly key: string;
  readonly label: string;
  readonly members: readonly CharacterSummary[];
}

export const NO_GROUP = "__none";

/**
 * Characters by the group nearest them on their page (their club before their
 * school), named by `nameOf`; those in none trail as "No group".
 */
export function groupByNearest(
  characters: readonly CharacterSummary[],
  nameOf: (id: string) => string,
): Group[] {
  const groups = new Map<string, CharacterSummary[]>();
  for (const character of characters) {
    const key = character.groups?.[0] ?? NO_GROUP;
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      label: key === NO_GROUP ? "No group" : nameOf(key),
      members: members.toSorted((x, y) => x.name.localeCompare(y.name)),
    }))
    .sort((a, b) =>
      a.key === NO_GROUP
        ? 1
        : b.key === NO_GROUP
          ? -1
          : a.label.localeCompare(b.label),
    );
}

/**
 * Characters by the first letter of their name, like a contact list: Latin
 * letters by their base letter (Ō under O), other scripts by their first
 * character, and anything else under "#" at the end.
 */
export function groupByLetter(
  characters: readonly CharacterSummary[],
): Group[] {
  const groups = new Map<string, CharacterSummary[]>();
  for (const character of characters) {
    const first = [
      ...character.name
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, ""),
    ][0];
    const key = first && /\p{L}/u.test(first) ? first.toUpperCase() : "#";
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      label: key,
      members: members.toSorted((x, y) => x.name.localeCompare(y.name)),
    }))
    .sort((a, b) =>
      a.key === "#" ? 1 : b.key === "#" ? -1 : a.key.localeCompare(b.key),
    );
}

/** What a character is doing now, busiest first; each has one (`activityOf`). */
export const ACTIVITIES = [
  { key: "thinking", label: "Thinking" },
  { key: "composing", label: "Composing" },
  { key: "waiting", label: "Waiting" },
  { key: "played", label: "Played" },
  { key: "idle", label: "Idle" },
  { key: "offstage", label: "Offstage" },
] as const;
export type Activity = (typeof ACTIVITIES)[number]["key"];

/**
 * One activity per character, so the counts add up to the cast: someone
 * thinking with messages waiting is thinking, and composing beats thinking.
 * Waiting means messages they haven't read yet. Without a status, idle.
 */
export function activityOf(status: CharacterStatus | undefined): Activity {
  if (!status) return "idle";
  if (!status.onstage) return "offstage";
  if (status.composingIn.length > 0) return "composing";
  if (status.brain === "thinking") return "thinking";
  if (status.playedBy) return "played";
  if (status.queued > 0) return "waiting";
  return "idle";
}

/** Characters by what they're doing, busiest first, empty activities left out. */
export function groupByActivity(
  characters: readonly CharacterSummary[],
  statusOf: (id: string) => CharacterStatus | undefined,
): Group[] {
  const groups = new Map<Activity, CharacterSummary[]>();
  for (const character of characters) {
    const key = activityOf(statusOf(character.id));
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  return ACTIVITIES.flatMap(({ key, label }) => {
    const members = groups.get(key);
    return members
      ? [
          {
            key,
            label,
            members: members.toSorted((x, y) => x.name.localeCompare(y.name)),
          },
        ]
      : [];
  });
}
