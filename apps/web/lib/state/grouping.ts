import type { CharacterStatus, CharacterSummary } from "@kazusa/client";

export type GroupBy = "none" | "affiliation" | "activity" | "brain";
export type KindFilter = "simulated" | "npc" | "everyone";

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: "None",
  affiliation: "Affiliation",
  activity: "Activity type",
  brain: "Brain state",
};

export interface Group {
  readonly key: string;
  readonly label: string;
  readonly members: readonly CharacterSummary[];
}

export function filterCharacters(
  characters: readonly CharacterSummary[],
  kind: KindFilter,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return characters.filter((character) => {
    if (kind === "simulated" && character.kind !== "agent") return false;
    if (kind === "npc" && character.kind !== "npc") return false;
    if (!needle) return true;
    return (
      character.name.toLowerCase().includes(needle) ||
      character.id.toLowerCase().includes(needle) ||
      character.aliases.some((alias) => alias.toLowerCase().includes(needle))
    );
  });
}

/** Honest buckets: characters without the structured field land in a named "none" group. */
export function groupCharacters(
  characters: readonly CharacterSummary[],
  by: GroupBy,
  statusOf: (id: string) => CharacterStatus | undefined,
): Group[] {
  if (by === "none")
    return [
      {
        key: "all",
        label: "All",
        members: [...characters].sort((x, y) => x.name.localeCompare(y.name)),
      },
    ];
  const groups = new Map<string, CharacterSummary[]>();
  const keyOf = (character: CharacterSummary) => {
    if (by === "affiliation") return character.affiliation ?? "";
    const status = statusOf(character.id);
    if (by === "activity") return status?.task?.type ?? "";
    return status?.brain ?? "";
  };
  for (const character of characters) {
    const key = keyOf(character);
    groups.set(key, [...(groups.get(key) ?? []), character]);
  }
  const fallback = {
    affiliation: "No affiliation",
    activity: "No current task",
    brain: "No status",
  }[by];
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([key, members]) => ({
      key: key || "__none",
      label: key ? key.charAt(0).toUpperCase() + key.slice(1) : fallback,
      members: [...members].sort((x, y) => x.name.localeCompare(y.name)),
    }));
}
