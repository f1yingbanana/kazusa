"use client";

import type { Agent } from "@kazusa/client";
import { useCallback } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useSources } from "@/lib/source/provider";

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly isSelf: boolean;
  readonly isAgent: boolean;
}

export function resolveParticipant(
  id: string,
  agentsById: ReadonlyMap<string, Agent>,
  self: { userId: string; userName: string },
): Participant {
  if (id === self.userId) {
    return { id, name: self.userName || "You", isSelf: true, isAgent: false };
  }
  const agent = agentsById.get(id);
  if (agent) {
    return {
      id,
      name: agent.name,
      avatarUrl: agent.avatarUrl,
      isSelf: false,
      isAgent: true,
    };
  }
  return { id, name: id, isSelf: false, isAgent: false };
}

/** Who a message's sender is: you, a character, or the name it was sent under. */
export function useParticipantResolver() {
  const { byId } = useCharacters();
  const { player } = useSources();
  return useCallback(
    (id: string, fallbackName?: string) => {
      const participant = resolveParticipant(id, byId, {
        userId: player.id,
        userName: player.name,
      });
      if (!participant.isAgent && !participant.isSelf && fallbackName) {
        return { ...participant, name: fallbackName };
      }
      return participant;
    },
    [byId, player.id, player.name],
  );
}
