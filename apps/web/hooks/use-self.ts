"use client";

import { useCallback } from "react";
import { selfIn } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";

/**
 * Who "you" are in a chat: yourself in your console with the system agent, the
 * character you play everywhere else.
 */
export function useSelfIn(): (chat: {
  readonly members: readonly string[];
}) => string {
  const { player, operator } = useSources();
  return useCallback(
    (chat) => selfIn(chat, player.id, operator.id),
    [player.id, operator.id],
  );
}
