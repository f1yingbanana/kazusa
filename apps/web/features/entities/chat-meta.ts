"use client";

import type { ChatType } from "@kazusa/client";
import {
  MessageCircleIcon,
  SpeechIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useChats } from "@/hooks/use-chats";
import { useObservedChat } from "@/hooks/use-observed-chats";
import type { Chat } from "@/lib/source/chats/types";
import { useDraftChat } from "@/lib/state/chat-draft";

const CHAT_ICON: Record<ChatType, LucideIcon> = {
  direct: MessageCircleIcon,
  group: UsersIcon,
  huddle: SpeechIcon,
};

/** Text chats are on the phone; a huddle is people talking face to face. */
export function chatIcon(type: ChatType): LucideIcon {
  return CHAT_ICON[type];
}

function typeOfId(id: string): ChatType {
  return id.startsWith("direct")
    ? "direct"
    : id.startsWith("huddle")
      ? "huddle"
      : "group";
}

/**
 * Resolves a chat from the player's chats, then the ones they can observe.
 * `readable`: it can be opened, as a participant or from outside.
 */
export function useChatTitle(id: string): {
  title: string;
  type: ChatType;
  mine: boolean;
  readable: boolean;
  members: readonly string[];
  ended?: boolean;
  placeId?: string;
  joinable?: boolean;
  draft?: boolean;
} {
  const { chats } = useChats();
  const draft = useDraftChat();
  const mine: Chat | undefined =
    chats.find((chat) => chat.id === id) ??
    (draft?.id === id ? draft : undefined);
  const { chat: observed } = useObservedChat(mine ? null : id);
  if (mine) {
    return {
      title: mine.name,
      type: mine.type,
      mine: true,
      readable: true,
      members: mine.members,
      placeId: mine.placeId,
      joinable: mine.joinable,
      draft: mine.draft,
    };
  }
  if (observed) {
    return {
      title: observed.name,
      type: observed.type,
      mine: false,
      readable: true,
      members: observed.members,
      ended: observed.ended,
      placeId: observed.placeId,
      joinable: observed.joinable,
    };
  }
  return {
    title: "A chat",
    type: typeOfId(id),
    mine: false,
    readable: false,
    members: [],
  };
}
