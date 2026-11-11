import { create } from "zustand";
import type { Chat } from "../source/chats/types";

/**
 * The one not-yet-sent chat (a new DM or group), shared because the sidebar
 * creates groups while the Chats stage view renders them; and what is written
 * but not sent in each chat, shared because a huddle's scene and transcript
 * each have their own reply box for the same draft. Not persisted.
 */
export interface ChatDraftState {
  readonly draft: Chat | null;
  /** What is written but not sent, by chat id; an empty draft is absent. */
  readonly messages: Readonly<Record<string, string>>;
}

export const useChatDraftStore = create<ChatDraftState>()(() => ({
  draft: null,
  messages: {},
}));

export function setDraftChat(next: Chat | null): void {
  useChatDraftStore.setState({ draft: next });
}

export function useDraftChat(): Chat | null {
  return useChatDraftStore((state) => state.draft);
}

/** Changes what is written in `chatId`; an empty draft is forgotten. */
export function setMessageDraft(chatId: string, text: string): void {
  useChatDraftStore.setState((state) => {
    if ((state.messages[chatId] ?? "") === text) return state;
    const messages = { ...state.messages };
    if (text === "") delete messages[chatId];
    else messages[chatId] = text;
    return { messages };
  });
}

export function useMessageDraft(chatId: string): string {
  return useChatDraftStore((state) => state.messages[chatId] ?? "");
}
