import type { ChatInfo } from "./types";

/**
 * How a list of other people's chats is laid out. Talking face to face and
 * texting are different things to watch, so they are kept apart: who is talking
 * in person now first, then text chats, then the talks in person that are over
 * (there are soon far more of those than of anything else).
 */
export type ChatSectionId = "in-person" | "messages" | "earlier";

export interface ChatSection {
  readonly id: ChatSectionId;
  readonly label: string;
  readonly chats: readonly ChatInfo[];
}

const LABELS: Readonly<Record<ChatSectionId, string>> = {
  "in-person": "In person",
  messages: "Messages",
  earlier: "Earlier in person",
};

/** The sections with anything in them, each in the order its chats came. */
export function chatSections(chats: readonly ChatInfo[]): ChatSection[] {
  const sorted: Record<ChatSectionId, ChatInfo[]> = {
    "in-person": [],
    messages: [],
    earlier: [],
  };
  for (const chat of chats)
    sorted[
      chat.type !== "huddle" ? "messages" : chat.ended ? "earlier" : "in-person"
    ].push(chat);
  return (["in-person", "messages", "earlier"] as const)
    .filter((id) => sorted[id].length > 0)
    .map((id) => ({ id, label: LABELS[id], chats: sorted[id] }));
}

/**
 * The conversation to show someone who just arrived to watch: one where
 * somebody is speaking or typing now, else people talking in person, else
 * whatever was said last. In each, the first of `chats` wins (newest first).
 */
export function liveliestChat(
  chats: readonly ChatInfo[],
  composingIn: ReadonlySet<string>,
): ChatInfo | undefined {
  const open = chats.filter((chat) => !chat.ended);
  const inPerson = (chat: ChatInfo) => chat.type === "huddle";
  const composing = open.filter((chat) => composingIn.has(chat.id));
  return (
    composing.find(inPerson) ??
    composing[0] ??
    open.find(inPerson) ??
    open[0] ??
    chats[0]
  );
}
