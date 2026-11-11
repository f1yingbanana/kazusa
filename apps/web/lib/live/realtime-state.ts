import { create } from "zustand";
import type { Chat, TypingStreamEvent } from "@kazusa/client";

export type ConnectionStatus = "connecting" | "open" | "error";
export interface Typist {
  readonly senderId: string;
  readonly senderName: string;
  readonly mode: TypingStreamEvent["mode"];
  readonly expiresAt?: number;
  /** The line being said aloud, and when (a scene opened mid-line shows it). */
  readonly speech?: TypingStreamEvent["speech"];
}

export interface RealtimeState {
  readonly status: ConnectionStatus;
  readonly typingByChat: Readonly<Record<string, readonly Typist[]>>;
  readonly unreadByChat: Readonly<Record<string, number>>;
  readonly activeChat: string | null;
}

export const useRealtimeStore = create<RealtimeState>()(() => ({
  status: "connecting",
  typingByChat: {},
  unreadByChat: {},
  activeChat: null,
}));

export function setStatus(status: ConnectionStatus): void {
  useRealtimeStore.setState({ status });
}

export function setActiveChat(activeChat: string | null): void {
  useRealtimeStore.setState((state) => {
    if (!activeChat || !state.unreadByChat[activeChat]) return { activeChat };
    const unreadByChat = { ...state.unreadByChat };
    delete unreadByChat[activeChat];
    return { activeChat, unreadByChat };
  });
}

export function receiveMessage(chatId: string, incoming: boolean): void {
  useRealtimeStore.setState((state) =>
    incoming && state.activeChat !== chatId
      ? {
          unreadByChat: {
            ...state.unreadByChat,
            [chatId]: (state.unreadByChat[chatId] ?? 0) + 1,
          },
        }
      : state,
  );
}

export function clearUnread(): void {
  useRealtimeStore.setState({ unreadByChat: {} });
}

export function clearTyping(): void {
  useRealtimeStore.setState((state) =>
    Object.keys(state.typingByChat).length ? { typingByChat: {} } : state,
  );
}

export function clearTypist(chatId: string, senderId: string): void {
  useRealtimeStore.setState((state) => {
    const list = state.typingByChat[chatId];
    if (!list?.some((t) => t.senderId === senderId)) return state;
    const typingByChat = { ...state.typingByChat };
    const retained = list.filter((t) => t.senderId !== senderId);
    if (retained.length) typingByChat[chatId] = retained;
    else delete typingByChat[chatId];
    return { typingByChat };
  });
}

export function applyTyping(event: TypingStreamEvent): void {
  if (!event.isTyping) {
    clearTypist(event.chatId, event.senderId);
    return;
  }
  useRealtimeStore.setState((state) => ({
    typingByChat: {
      ...state.typingByChat,
      [event.chatId]: [
        ...(state.typingByChat[event.chatId] ?? []).filter(
          (t) => t.senderId !== event.senderId,
        ),
        {
          senderId: event.senderId,
          senderName: event.senderName,
          mode: event.mode,
          expiresAt: event.expiresAt,
          ...(event.speech ? { speech: event.speech } : {}),
        },
      ],
    },
  }));
}

export function retainMembers(
  chats: readonly Pick<Chat, "id" | "members">[],
): void {
  useRealtimeStore.setState((state) => {
    const typingByChat = { ...state.typingByChat };
    let changed = false;
    for (const chat of chats) {
      const list = typingByChat[chat.id];
      if (!list) continue;
      const retained = list.filter((t) => chat.members.includes(t.senderId));
      if (retained.length !== list.length) {
        if (retained.length) typingByChat[chat.id] = retained;
        else delete typingByChat[chat.id];
        changed = true;
      }
    }
    return changed ? { typingByChat } : state;
  });
}

export function expireTyping(now: number): void {
  useRealtimeStore.setState((state) => {
    const typingByChat = { ...state.typingByChat };
    let changed = false;
    for (const [id, list] of Object.entries(typingByChat)) {
      const alive = list.filter(
        (t) => t.expiresAt === undefined || t.expiresAt > now,
      );
      if (alive.length === list.length) continue;
      changed = true;
      if (alive.length) typingByChat[id] = alive;
      else delete typingByChat[id];
    }
    return changed ? { typingByChat } : state;
  });
}

const NO_TYPISTS: readonly Typist[] = [];
export function useTyping(chatId: string): readonly Typist[] {
  return useRealtimeStore((state) => state.typingByChat[chatId] ?? NO_TYPISTS);
}
