import { parseAsString, parseAsStringLiteral } from "nuqs";
import { chatSubject } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import type { EntityRef } from "@/lib/state/entity-ref";
import { entityRefParser } from "@/lib/state/entity-ref";
import { chatsParsers } from "./search-params";

/**
 * Where a conversation opens. Texts are your phone's: Chats. Talking face to
 * face happens somewhere: World, at the place, over the map (`world.talk`).
 * `world.with` asks to talk with someone standing where you are, `world.as`
 * draws a talk as a scene or its transcript.
 */
export const conversationParsers = {
  view: parseAsString,
  sel: entityRefParser,
  "chats.id": chatsParsers["chats.id"],
  "world.talk": parseAsString,
  "world.with": parseAsString,
  "world.as": parseAsStringLiteral(["scene", "list"] as const),
};

export interface ConversationPatch {
  view: string;
  "chats.id": string | null;
  "world.talk": string | null;
  sel?: EntityRef;
}

/**
 * Opens a conversation and points the details panel at its subject in one URL
 * change, so the panel never shows the last selection beside the new one.
 */
export function conversationPatch(
  chat: ChatInfo,
  userId: string,
): ConversationPatch {
  const subject = chatSubject(chat, userId);
  const huddle = chat.type === "huddle";
  return {
    view: huddle ? "world" : "chats",
    "chats.id": huddle ? null : chat.id,
    "world.talk": huddle ? chat.id : null,
    ...(subject ? { sel: subject } : {}),
  };
}
