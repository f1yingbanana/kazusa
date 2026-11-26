"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useMemo, type ReactNode } from "react";
import type { CastPick } from "@/hooks/use-cast-picks";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { Avatar } from "@/ui/avatar";
import type { PickOption } from "@/ui/combobox";
import type { PickItem } from "@/ui/pick-list";
import { CharacterAvatar } from "./character-avatar";

/** Renders an option row's avatar for a cast member or person fallback. */
export function PersonOptionAvatar({
  name,
  person,
  size = "xs",
}: {
  name: string;
  person: CharacterSummary | undefined;
  size?: "xs" | "sm";
}) {
  return person ? (
    <CharacterAvatar
      id={person.id}
      name={person.name}
      avatarUrl={person.avatarUrl}
      kind={person.kind}
      size={size}
      decorative
    />
  ) : (
    <Avatar name={name} size={size} decorative />
  );
}

/** Unified Combobox/AddPicker/OnePicker option for any character, with avatar. */
export function personPickOption(character: CharacterSummary): PickOption {
  return {
    value: character.id,
    label: character.name,
    keywords: [character.id, ...character.aliases],
    media: (
      <CharacterAvatar
        id={character.id}
        name={character.name}
        avatarUrl={character.avatarUrl}
        kind={character.kind}
        size="xs"
        decorative
      />
    ),
  };
}

/** Unified PickList/ChooseList item for a cast member, with avatar and aliases. */
export function castPickItem(pick: CastPick, sub?: string): PickItem {
  return {
    value: pick.id,
    label: pick.name,
    keywords: pick.aliases,
    muted: pick.offstage,
    media: (
      <CharacterAvatar
        id={pick.id}
        name={pick.name}
        avatarUrl={pick.avatarUrl}
        kind="agent"
        size="sm"
        decorative
      />
    ),
    ...(sub ? { sub } : {}),
  };
}

/**
 * Character options with avatars and alias keywords for dropdowns and row
 * pickers, sorted by name. Excludes system agents by default.
 */
export function useCharacterOptions({
  exclude = [],
  agentOnly = false,
}: {
  exclude?: readonly string[];
  agentOnly?: boolean;
} = {}): {
  options: readonly PickOption[];
  mediaOf: (id: string, fallbackName?: string) => ReactNode;
} {
  const { characters, byId } = useCharacters();
  const excludedKey = exclude.join("\0");

  const options = useMemo(() => {
    const skip = new Set(excludedKey ? excludedKey.split("\0") : []);
    return characters
      .filter(
        (c) =>
          isCast(c) && !skip.has(c.id) && (!agentOnly || c.kind === "agent"),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(personPickOption);
  }, [characters, excludedKey, agentOnly]);

  const mediaOf = (id: string, fallbackName?: string): ReactNode => {
    const person = byId.get(id);
    return (
      <PersonOptionAvatar
        name={person?.name ?? fallbackName ?? id}
        person={person}
        size="xs"
      />
    );
  };

  return { options, mediaOf };
}
