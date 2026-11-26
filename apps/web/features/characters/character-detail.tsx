"use client";

import type { ComponentType } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useRunsOnModel } from "@/hooks/use-models";
import { useSources } from "@/lib/source/provider";
import type { EntityRef } from "@/lib/state/entity-ref";
import { Detail, DetailAbout, DetailHeader } from "@/ui/detail";
import { Fold, Folds } from "@/ui/fold";
import { Note } from "@/ui/note";
import { CharacterRecentSection, CharacterRecentSummary } from "./recent";
import { CharacterStatesSection, CharacterStatesSummary } from "./states";
import { useWorldNow } from "../world/world-state";
import { CharacterActions, FailureLine, StatusLine } from "./character-actions";
import { CharacterAvatar } from "./character-avatar";
import { Desires } from "./desires";
import { usePresence } from "./presence";
import { RichText } from "../wiki/links";
import { RightNow } from "./right-now";
import {
  CharacterContextSection,
  CharacterContextSummary,
  CharacterModelSection,
  CharacterModelSummary,
} from "./settings-folds";

type FoldSpec = {
  value: string;
  title: string;
  Section: ComponentType<{ entity: EntityRef }>;
  Summary: ComponentType<{ entity: EntityRef }>;
};

/**
 * The folds under someone's live state: their states, and for whoever runs the
 * world their model and context. `recent` adds their latest events, which a
 * profile shows as its Story instead.
 */
export function CharacterFolds({
  id,
  recent = true,
  yours = false,
}: {
  id: string;
  recent?: boolean;
  /** The one you play: you think for them, so no recent turns, model or context. */
  yours?: boolean;
}) {
  const { hasPermission } = useAccess();
  const runsOnModel = useRunsOnModel({ id });
  const entity: EntityRef = { kind: "character", id };
  const folds: FoldSpec[] = [
    {
      value: "states",
      title: "States",
      Section: CharacterStatesSection,
      Summary: CharacterStatesSummary,
    },
    ...(recent && !yours
      ? [
          {
            value: "recent",
            title: "Recent",
            Section: CharacterRecentSection,
            Summary: CharacterRecentSummary,
          },
        ]
      : []),
    ...(hasPermission("manage") && runsOnModel && !yours
      ? [
          {
            value: "model",
            title: "Model",
            Section: CharacterModelSection,
            Summary: CharacterModelSummary,
          },
          {
            value: "context",
            title: "Context",
            Section: CharacterContextSection,
            Summary: CharacterContextSummary,
          },
        ]
      : []),
  ];
  return (
    <Folds>
      {folds.map(({ value, title, Section, Summary }) => (
        <Fold
          key={value}
          value={value}
          title={title}
          summary={<Summary entity={entity} />}
        >
          <Section entity={entity} />
        </Fold>
      ))}
    </Folds>
  );
}

/**
 * Read in the order a watcher asks: who is this, what can I do, where are they
 * and with whom, how do they feel. Their profile in Characters goes deeper.
 */
export function CharacterDetail({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const { status, presence } = usePresence({ id, kind: character?.kind });
  const { rooms } = useWorldNow();
  const { player } = useSources();
  const yours = id === player.id;

  if (!character)
    return <Note inset="panel">{`Nobody called "${id}" here.`}</Note>;

  const room = rooms.find((r) => r.members.some((m) => m.id === id));
  const company = room?.members.filter((m) => m.id !== id) ?? [];
  const failure = status?.brain === "thinking" ? undefined : status?.failure;

  return (
    <Detail label={character.name}>
      <DetailHeader
        media={
          <CharacterAvatar
            id={character.id}
            name={character.name}
            avatarUrl={character.avatarUrl}
            kind={character.kind}
          />
        }
        title={character.name}
        subtitle={<StatusLine character={character} presence={presence} />}
        onClose={onClose}
      />

      {failure ? <FailureLine error={failure.error} /> : null}

      <CharacterActions character={character} />

      {character.summary ? (
        <DetailAbout>
          <RichText text={character.summary} />
        </DetailAbout>
      ) : null}

      <RightNow character={character} company={company} />

      {character.kind === "agent" && !yours ? <Desires id={id} /> : null}

      <CharacterFolds id={id} yours={yours} />
    </Detail>
  );
}
