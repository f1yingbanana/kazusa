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

/** Where a character's mind is, busiest first; each has one (`statusOf`). */
export const STATUSES = [
  { key: "thinking", label: "Thinking" },
  { key: "composing", label: "Composing" },
  { key: "waiting", label: "Waiting" },
  { key: "idle", label: "Idle" },
  { key: "offstage", label: "Offstage" },
] as const;
export type Status = (typeof STATUSES)[number]["key"];

/**
 * One status per character, so the counts add up to the cast: someone thinking
 * with messages waiting is thinking, and composing beats thinking. Waiting
 * means messages they haven't read yet. Without a status, idle.
 */
export function statusOf(status: CharacterStatus | undefined): Status {
  if (!status) return "idle";
  if (!status.onstage) return "offstage";
  if (status.composingIn.length > 0) return "composing";
  if (status.brain === "thinking") return "thinking";
  if (status.queued > 0) return "waiting";
  return "idle";
}

function sorted(members: readonly CharacterSummary[]) {
  return members.toSorted((x, y) => x.name.localeCompare(y.name));
}

/** Characters by status, busiest first, empty ones left out. */
export function groupByStatus(
  characters: readonly CharacterSummary[],
  statusFor: (id: string) => CharacterStatus | undefined,
): Group[] {
  const groups = new Map<Status, CharacterSummary[]>();
  for (const character of characters) {
    const key = statusOf(statusFor(character.id));
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  return STATUSES.flatMap(({ key, label }) => {
    const members = groups.get(key);
    return members ? [{ key, label, members: sorted(members) }] : [];
  });
}

const NO_TASK = "__idle";
const OFFSTAGE = "__offstage";

/**
 * Characters by what they're doing in the world: their task's category
 * (sleeping, eating, traveling), in `order` (the world's own categories) and
 * any others after by name; then those with no task, then everyone offstage.
 */
export function groupByActivity(
  characters: readonly CharacterSummary[],
  statusFor: (id: string) => CharacterStatus | undefined,
  order: readonly string[],
  labelOf: (category: string) => string,
): Group[] {
  const groups = new Map<string, CharacterSummary[]>();
  for (const character of characters) {
    const status = statusFor(character.id);
    const key =
      status?.onstage === false ? OFFSTAGE : (status?.task?.type ?? NO_TASK);
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  const rank = (key: string) =>
    key === OFFSTAGE
      ? Infinity
      : key === NO_TASK
        ? order.length + 1
        : order.includes(key)
          ? order.indexOf(key)
          : order.length;
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      label:
        key === OFFSTAGE
          ? "Offstage"
          : key === NO_TASK
            ? "Nothing in particular"
            : labelOf(key),
      members: sorted(members),
    }))
    .sort(
      (a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label),
    );
}
