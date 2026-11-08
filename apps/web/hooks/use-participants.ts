"use client";

import { useCallback } from "react";
import { resolveParticipant } from "@/components/views/chats/chat-avatar";
import { useCharacters } from "@/hooks/use-characters";
import { useSources } from "@/lib/source/provider";

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
