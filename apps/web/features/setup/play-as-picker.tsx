"use client";

import { useMemo } from "react";
import type { WorldOption } from "@/lib/setup/setup";
import { Avatar } from "@/ui/avatar";
import { ChooseList } from "@/ui/choose-list";
import type { PickGroup } from "@/ui/pick-list";
import { SetupCharacterCard, WatchMark } from "./character-card";

/** The Play as choice for nobody: no character id starts with a colon. */
export const OBSERVER = ":observer";

/** Who the person plays from the first start: one of the cast, or nobody. */
export function PlayAsPicker({
  world,
  value,
  onChange,
}: {
  world: WorldOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const groupNames = useMemo(() => world.groupNames ?? {}, [world.groupNames]);
  const byId = useMemo(
    () => new Map(world.characters.map((c) => [c.id, c])),
    [world.characters],
  );
  const suggested = world.defaultUserCharacter
    ? byId.get(world.defaultUserCharacter)
    : undefined;

  const groups = useMemo<PickGroup[]>(() => {
    const itemFor = (
      character: (typeof world.characters)[number],
      fallbackSub?: string,
    ) => {
      const primary = character.groups?.[0];
      return {
        value: character.id,
        label: character.name,
        keywords: [...(character.aliases ?? [])],
        sub: primary ? (groupNames[primary] ?? primary) : fallbackSub,
        media: (
          <Avatar
            name={character.name}
            src={character.avatarUrl}
            size="sm"
            decorative
          />
        ),
      };
    };

    const rest = world.characters
      .filter((c) => c.id !== suggested?.id)
      .map((c) => itemFor(c));

    return [
      {
        label: "Watch",
        items: [
          {
            value: OBSERVER,
            label: "Observer",
            sub: "Watch without playing anyone",
            keywords: ["observer", "watch", "nobody"],
            media: <WatchMark />,
          },
        ],
      },
      ...(suggested
        ? [
            {
              label: "Recommended",
              items: [itemFor(suggested, "World default")],
            },
          ]
        : []),
      ...(rest.length
        ? [
            {
              label: "Characters",
              items: rest,
            },
          ]
        : []),
    ];
  }, [world.characters, suggested, groupNames]);

  const chosen = value === OBSERVER ? undefined : byId.get(value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:grid sm:grid-cols-[20rem_minmax(0,1fr)] sm:gap-4">
      <ChooseList
        label="Who to play"
        groups={groups}
        value={value}
        onValueChange={onChange}
        placeholder={`Search ${world.characters.length} characters`}
        className="min-h-0 flex-1 sm:h-full"
      />
      <SetupCharacterCard
        character={chosen}
        groupNames={groupNames}
        className="shrink-0 sm:h-full sm:overflow-y-auto"
      />
    </div>
  );
}
