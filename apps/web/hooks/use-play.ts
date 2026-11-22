"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryState } from "nuqs";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useSWRConfig } from "swr";
import { useAccess } from "@/hooks/use-access";
import { playAs } from "@/lib/source/player/http";
import { CHARACTERS_KEY, useSources, WORLD_KEY } from "@/lib/source/provider";
import { useSelection } from "@/hooks/use-selection";
import { setDraftChat, useChatDraftStore } from "@/lib/state/chat-draft";
import { closeInspectorTab } from "@/lib/state/ui-store";

/**
 * Who the person plays, and `play` for switching: a character's id, or `null`
 * to watch. `play` is absent without the permission to play; `canAct` says
 * whether there is someone to act as now (permitted, and playing someone).
 */
export function usePlay() {
  const { player, watching } = useSources();
  const { canPlay } = useAccess();
  const { mutate } = useSWRConfig();
  const play = useCallback(
    async (id: string | null) => {
      const { player: next } = await playAs(id);
      // The world says who is played; SSE says so too, a moment later.
      await mutate(WORLD_KEY);
      void mutate(CHARACTERS_KEY);
      return next;
    },
    [mutate],
  );
  return {
    player,
    watching,
    play: canPlay ? play : undefined,
    canAct: canPlay && !watching,
  };
}

/**
 * Who you play changed (here, in another tab, or by anyone): an unsent chat was
 * written as the one before, so it goes, and is left if it was open, rather
 * than be sent as someone else. Mounted once, in the shell.
 */
export function useSwitchResets(): void {
  const { player } = useSources();
  const [chatId, setChatId] = useQueryState(
    "chats.id",
    chatsParsers["chats.id"],
  );
  const [selection, select] = useSelection();
  const selected = selection?.kind === "chat" ? selection.id : undefined;
  const before = useRef(player.id);
  useEffect(() => {
    if (before.current === player.id) return;
    before.current = player.id;
    const { draft } = useChatDraftStore.getState();
    if (!draft) return;
    setDraftChat(null);
    if (chatId === draft.id) void setChatId(null);
    if (selected === draft.id) {
      closeInspectorTab("chat");
      void select(null);
    }
  }, [player.id, chatId, setChatId, selected, select]);
}
