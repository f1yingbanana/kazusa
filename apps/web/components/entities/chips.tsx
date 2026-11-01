"use client";

import {
  MapPinIcon,
  MessageCircleIcon,
  SpeechIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { ChatType } from "@kazusa/client";
import { useChats } from "@/hooks/use-chats";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useCharacter } from "@/hooks/use-characters";
import { usePlace } from "@/hooks/use-location";
import { useNavigate } from "@/hooks/use-url-state";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { cn } from "@/lib/utils";
import { PresenceAvatar } from "./presence-avatar";

const chipClass =
  "inline-flex max-w-40 min-w-0 items-center sm:max-w-48 gap-1.5 rounded-md px-1 py-0.5 align-middle text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

export function CharacterChip({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const character = useCharacter(id);
  const navigate = useNavigate();
  const name = character?.name ?? id;
  return (
    <button
      type="button"
      className={cn(chipClass, className)}
      onClick={() =>
        navigate({ sel: serializeEntityRef({ kind: "character", id }) })
      }
    >
      <PresenceAvatar
        id={id}
        name={name}
        avatarUrl={character?.avatarUrl}
        kind={character?.kind}
        size="xs"
      />
      <span className="truncate">{name}</span>
    </button>
  );
}

const CHAT_ICON: Record<ChatType, LucideIcon> = {
  direct: MessageCircleIcon,
  group: UsersIcon,
  huddle: SpeechIcon,
};

/** Text chats are on the phone; a huddle is people talking face to face. */
export function chatIcon(type: ChatType): LucideIcon {
  return CHAT_ICON[type];
}

/** An id's prefix is its chat type; the id itself is opaque, never a title. */
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
} {
  const { chats } = useChats();
  const mine = chats.find((chat) => chat.id === id);
  const { chat: observed } = useObservedChat(mine ? null : id);
  if (mine) {
    return {
      title: mine.name,
      type: mine.type,
      mine: true,
      readable: true,
      members: mine.members,
      placeId: mine.placeId,
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

export function ChatChip({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const { title, type } = useChatTitle(id);
  const navigate = useNavigate();
  const Icon = chatIcon(type);
  return (
    <button
      type="button"
      className={cn(chipClass, className)}
      onClick={() =>
        navigate({ sel: serializeEntityRef({ kind: "chat", id }) })
      }
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{title}</span>
    </button>
  );
}

/** `bare` drops the pin where the context already says it is a place. */
export function PlaceChip({
  id,
  bare,
  className,
}: {
  id: string;
  bare?: boolean;
  className?: string;
}) {
  const place = usePlace(id);
  const navigate = useNavigate();
  return (
    <button
      type="button"
      title={place?.summary}
      className={cn(chipClass, className)}
      onClick={() =>
        navigate({ sel: serializeEntityRef({ kind: "place", id }) })
      }
    >
      {bare ? null : (
        <MapPinIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="truncate">{place?.name ?? id}</span>
    </button>
  );
}
