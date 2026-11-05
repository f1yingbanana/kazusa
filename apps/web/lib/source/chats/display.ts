import type { ChatMessage } from "@kazusa/client";
import { serializeEntityRef, type EntityRef } from "../../state/entity-ref";
import type { ChatInfo } from "./types";

type NameOf = (id: string) => string;

/** "Airi, Natsu, Yoshimi +2". */
export function listNames(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

/**
 * The player's own direct chat: one other voice, so it needs no names. A direct
 * chat between two others, read from outside, has two.
 */
export function isOneOnOne(chat: ChatInfo, userId: string): boolean {
  return (
    chat.type === "direct" &&
    chat.members.filter((id) => id !== userId).length <= 1
  );
}

/**
 * The server titles an untitled chat by the first other member's id (a direct
 * chat always, a huddle usually), so those are named from their members.
 */
export function chatTitle(
  chat: ChatInfo,
  userId: string,
  nameOf: NameOf,
): string {
  const others = chat.members.filter((id) => id !== userId);
  if (chat.name && !chat.members.includes(chat.name)) return chat.name;
  if (chat.type === "direct" && others.length > 1)
    return others.map(nameOf).join(" & ");
  if (chat.type === "direct") return others[0] ? nameOf(others[0]) : chat.name;
  return listNames(others.map(nameOf)) || "Just you";
}

/**
 * What the inspector shows for an open chat: the partner of a direct chat (or
 * of a talk in person not started yet), otherwise the chat itself (members, and
 * a huddle's place), a draft group included.
 */
export function chatSubject(chat: ChatInfo, userId: string): EntityRef | null {
  const others = chat.members.filter((id) => id !== userId);
  if (isOneOnOne(chat, userId) || (chat.draft && others.length === 1)) {
    return others[0] ? { kind: "character", id: others[0] } : null;
  }
  return { kind: "chat", id: chat.id };
}

/**
 * Opens a chat and points the inspector at its subject in one URL change, so
 * the inspector never shows the previous selection beside the new chat.
 */
export function openChatPatch(
  chat: ChatInfo,
  userId: string,
): Record<string, string> {
  const subject = chatSubject(chat, userId);
  return {
    view: "chats",
    "chats.id": chat.id,
    ...(subject ? { sel: serializeEntityRef(subject) } : {}),
  };
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
  chat: ChatInfo,
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
  // A sticker's text describes the picture; a preview just says what it is.
  const text = message.type === "sticker" ? "Sticker" : message.text;
  if (message.senderId === userId) return `You: ${text}`;
  return isOneOnOne(chat, userId) ? text : `${name}: ${text}`;
}

/**
 * Where something of the player's stands: sent, or taken in by every character
 * it reached (read in a text chat, observed face to face).
 */
export interface Receipt {
  readonly read: boolean;
  /** Who has taken it in so far, first first. */
  readonly readers: readonly string[];
  /** How many characters it reached. */
  readonly total: number;
  /** When the last of them took it in (sim time), once all have. */
  readonly readAt?: number;
}

/** Undefined where there are no receipts: said only to people. */
export function messageReceipt(
  message: Pick<ChatMessage, "receipts">,
): Receipt | undefined {
  const receipts = message.receipts;
  if (!receipts?.length) return undefined;
  const read = receipts
    .flatMap((receipt) =>
      receipt.readAt === undefined ? [] : [{ ...receipt, at: receipt.readAt }],
    )
    .sort((a, b) => a.at - b.at);
  const all = read.length === receipts.length;
  return {
    read: all,
    readers: read.map((receipt) => receipt.id),
    total: receipts.length,
    ...(all ? { readAt: read.at(-1)?.at } : {}),
  };
}

/**
 * "Read 14:32", "Read by Airi · 1 of 3" or "Sent"; face to face, "Observed by
 * Airi 14:32", "Observed by everyone 14:32" or "Not observed yet".
 */
export function receiptLabel(
  receipt: Receipt,
  nameOf: NameOf,
  formatTime: (at: number) => string,
  inPerson = false,
): string {
  const names = listNames(receipt.readers.map(nameOf));
  if (receipt.read && receipt.readAt !== undefined) {
    const at = formatTime(receipt.readAt);
    if (receipt.total > 1)
      return `${inPerson ? "Observed" : "Read"} by everyone ${at}`;
    return inPerson ? `Observed by ${names} ${at}` : `Read ${at}`;
  }
  if (!receipt.readers.length) return inPerson ? "Not observed yet" : "Sent";
  return `${inPerson ? "Observed" : "Read"} by ${names} · ${receipt.readers.length} of ${receipt.total}`;
}
