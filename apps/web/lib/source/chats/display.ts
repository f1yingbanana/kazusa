import type { ChatMessage } from "@kazusa/client";
import type { EntityRef } from "../../state/entity-ref";
import type { Chat } from "./types";

type NameOf = (id: string) => string;

/** "Airi, Natsu, Yoshimi +2". */
export function listNames(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

/**
 * The server titles an untitled chat by the first other member's id (a direct
 * chat always, a huddle usually), so those are named from their members.
 */
export function chatTitle(chat: Chat, userId: string, nameOf: NameOf): string {
  const others = chat.members.filter((id) => id !== userId);
  if (chat.name && !chat.members.includes(chat.name)) return chat.name;
  if (chat.type === "direct") return others[0] ? nameOf(others[0]) : chat.name;
  return listNames(others.map(nameOf)) || "Just you";
}

/**
 * What the inspector shows for an open chat: the partner of a direct chat,
 * otherwise the chat itself (members, and a huddle's place). A draft group has
 * nothing to show yet.
 */
export function chatSubject(chat: Chat, userId: string): EntityRef | null {
  if (chat.type === "direct") {
    const partner = chat.members.find((id) => id !== userId);
    return partner ? { kind: "character", id: partner } : null;
  }
  return chat.draft ? null : { kind: "chat", id: chat.id };
}

/**
 * An action is stored in third person without its subject ("leans back. She
 * sips her tea."); the UI supplies the name. Tolerates a model that wraps it in
 * roleplay asterisks or names itself anyway, so the subject never doubles.
 * `rest` keeps its separator: " leans back", "'s tea goes cold".
 */
export function actionLine(
  name: string,
  text: string,
): { subject: string; rest: string } {
  const body = text.replace(/\*+/g, "").trim();
  const lower = body.toLowerCase();
  // Any part of the name: worlds differ on which part people go by.
  const named = [name, ...name.split(" ")].find(
    (part) =>
      part.length > 0 &&
      lower.startsWith(part.toLowerCase()) &&
      !/[\p{L}\p{N}]/u.test(body.charAt(part.length)),
  );
  return named
    ? { subject: body.slice(0, named.length), rest: body.slice(named.length) }
    : { subject: name, rest: ` ${body}` };
}

/** The chat list's one-line preview: who said it when that isn't obvious. */
export function messagePreview(
  message: Pick<ChatMessage, "text" | "type"> &
    Partial<Pick<ChatMessage, "senderId" | "senderName">>,
  chat: Chat,
  userId: string,
  nameOf: NameOf,
): string {
  if (!message.senderId) return message.text;
  const name = nameOf(message.senderId) || message.senderName || "";
  if (message.type === "action") {
    // Third person even for the player: "You leans back" would not parse.
    const line = actionLine(name, message.text);
    return line.subject + line.rest;
  }
  if (message.senderId === userId) return `You: ${message.text}`;
  return chat.type === "direct" ? message.text : `${name}: ${message.text}`;
}
