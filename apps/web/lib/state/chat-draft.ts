"use client";

import { create } from "zustand";
import type { Chat } from "../source/chats/types";

/**
 * The one not-yet-sent chat (a new DM or group). Shared because the sidebar
 * creates groups while the Chats stage view renders them.
 */
export interface ChatDraftState {
  readonly draft: Chat | null;
}

export const useChatDraftStore = create<ChatDraftState>()(() => ({
  draft: null,
}));

export function setDraftChat(next: Chat | null): void {
  useChatDraftStore.setState({ draft: next });
}

export function useDraftChat(): Chat | null {
  return useChatDraftStore((state) => state.draft);
}
