"use client";

import { useCallback } from "react";
import { resolveParticipant } from "@/components/views/chats/chat-avatar";
import { useCharacters } from "@/hooks/use-characters";
import { useKazusaConfig } from "@/lib/state/config-store";

/** Who a message's sender is: you, a character, or the name it was sent under. */
export function useParticipantResolver() {
  const { byId } = useCharacters();
  const { userId, userName } = useKazusaConfig();
  return useCallback(
    (id: string, fallbackName?: string) => {
      const participant = resolveParticipant(id, byId, { userId, userName });
      if (!participant.isAgent && !participant.isSelf && fallbackName) {
        return { ...participant, name: fallbackName };
      }
      return participant;
    },
    [byId, userId, userName],
  );
}
