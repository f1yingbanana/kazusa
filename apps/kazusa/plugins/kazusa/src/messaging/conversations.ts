import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { STICKER_NAME } from "../stickers/stickers.ts";

export const AGENT_ID = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(128);

export function isUser(id: string): boolean {
  return id.startsWith("user:");
}

export const PARTICIPANT_ID = z
  .string()
  .regex(/^(?:user:)?[a-z0-9][a-z0-9_-]*$/)
  .max(128);

export const CHAT_SESSION = z
  .string()
  .max(512)
  .regex(
    /^(?:agent:(?:user:)?[a-z0-9][a-z0-9_-]*:)?chat:(?:direct|group|huddle):(?:user:)?[a-z0-9][a-z0-9_-]*$/,
  );
export const TYPING = z.strictObject({
  sessionKey: CHAT_SESSION,
  isTyping: z.boolean(),
});
const MEMBERS = z
  .array(PARTICIPANT_ID)
  .min(1)
  .max(99)
  .refine(
    (members) => new Set(members).size === members.length,
    "Members must be distinct.",
  );
const TITLE = z.string().trim().min(1).max(160);

const CHAT_TARGET = z.strictObject({
  aloud: z.boolean().optional(),
  sessionKey: CHAT_SESSION.optional(),
  members: MEMBERS.optional(),
  title: TITLE.nullable().optional(),
});
const HAS_TARGET = [
  (params: z.infer<typeof CHAT_TARGET>) =>
    Boolean(params.sessionKey) || Boolean(params.members),
  { message: "Supply either a sessionKey or members for a chat." },
] as const;
const TEXT = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => text.trim().length > 0);

/** What a message is: words, or something done where others can see it. */
export const MESSAGE_TYPE = z.enum(["speech", "action"]);
/** ...or, sent by a character, a sticker from its own set. */
const DELIVERED_TYPE = z.enum(["speech", "action", "sticker"]);
export type MessageType = z.infer<typeof DELIVERED_TYPE>;

/** A sent sticker: its name in the sender's set and that file's version. */
export const STICKER_REF = z.strictObject({
  name: STICKER_NAME,
  v: z
    .string()
    .regex(/^[a-z0-9]+$/)
    .max(16),
});
export type StickerRef = z.infer<typeof STICKER_REF>;

const BUBBLE = z.union([
  TEXT(4_000),
  z.strictObject({
    text: TEXT(4_000),
    type: MESSAGE_TYPE.optional(),
  }),
]);
/** A sticker as delivered: what everyone reads, frozen when it is sent. */
const STICKER_BUBBLE = z.strictObject({
  text: TEXT(4_000),
  type: z.literal("sticker"),
  sticker: STICKER_REF,
});
/**
 * One bubble as a plain string (speech), with its type, or a sticker resolved
 * from the sender's set.
 */
export type Bubble = z.infer<typeof BUBBLE> | z.infer<typeof STICKER_BUBBLE>;

/** Absolute ceiling; the tool offers `messaging.maxBubbles`. */
const MAX_BUBBLES = 32;

/**
 * The `send_message` tool's arguments, with at most `maxBubbles` bubbles. A
 * character with stickers may also pick one of `stickers` by name; `about` is
 * that field's description. It only ever says something somewhere: a chat is
 * started by `create_group` or `talk`, so the address is always required (an
 * optional one was left out on 41% of follow-up sends, 2026-11-05).
 */
export const sendMessageSchema = (
  maxBubbles: number,
  stickers: readonly string[] = [],
  about = "",
) => {
  const [first, ...rest] = stickers;
  const bubble = first
    ? z.union([
        ...BUBBLE.options,
        z.strictObject({ sticker: z.enum([first, ...rest]).describe(about) }),
      ])
    : BUBBLE;
  return z.strictObject({
    sessionKey: CHAT_SESSION,
    messages: z.array(bubble).min(1).max(maxBubbles),
  });
};
/** A paced multi-bubble send; the host adapter supplies its identity. */
export const SPEECH_REQUEST = CHAT_TARGET.extend({
  messages: z
    .array(z.union([...BUBBLE.options, STICKER_BUBBLE]))
    .min(1)
    .max(MAX_BUBBLES),
  requestId: z.string().trim().min(1).max(128),
}).refine(...HAS_TARGET);

/** A bubble's words and type, and its sticker if it is one. */
export function bubbleOf(bubble: Bubble): {
  readonly text: string;
  readonly type: MessageType;
  readonly sticker?: StickerRef;
} {
  if (typeof bubble === "string") return { text: bubble, type: "speech" };
  if (bubble.type === "sticker") return bubble;
  return { text: bubble.text, type: bubble.type ?? "speech" };
}

/** Explicit action or sticker marker in recalled text; speech is the default. */
export function readAs(params: {
  readonly text: string;
  readonly type?: MessageType;
}): string {
  return params.type === "action" || params.type === "sticker"
    ? `[type=${params.type}] ${params.text}`
    : params.text;
}
export type SpeechParams = z.infer<typeof SPEECH_REQUEST>;

const MESSAGE = CHAT_TARGET.extend({
  text: TEXT(32_000),
  /** Absent: speech. */
  type: MESSAGE_TYPE.optional(),
  requestId: z.string().trim().min(1).max(128),
});
/**
 * One message as a person sends it. Delivery identity is supplied by the host
 * adapter, never the model.
 */
export const DELIVERY_REQUEST = MESSAGE.refine(...HAS_TARGET);
/** One canonical message, which may also be a character's sticker. */
export const DELIVERY = MESSAGE.extend({
  type: DELIVERED_TYPE.optional(),
  sticker: STICKER_REF.optional(),
})
  .refine(...HAS_TARGET)
  .refine((params) => (params.type === "sticker") === Boolean(params.sticker), {
    message: "A sticker message carries its sticker, and only it does.",
  });
export type SendMessageParams = z.infer<typeof DELIVERY>;

/** `create_group`: a text chat with others; one other is your direct chat. */
export const CREATE_GROUP = z.strictObject({
  members: MEMBERS,
  title: TITLE.optional(),
});
/** `talk`: turn to people where you are and join their conversation. */
export const TALK = z.strictObject({ members: MEMBERS });

export const LIST_CHATS = z.strictObject({
  query: z.string().trim().min(1).max(256).optional(),
});
export const MANAGE_CHAT = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("rename"),
    sessionKey: CHAT_SESSION,
    title: TITLE,
    members: z.unknown().optional(),
  }),
  z.strictObject({
    action: z.literal("add_members"),
    sessionKey: CHAT_SESSION,
    members: MEMBERS,
    title: z.unknown().optional(),
  }),
  z.strictObject({
    action: z.literal("remove_members"),
    sessionKey: CHAT_SESSION,
    members: MEMBERS,
    title: z.unknown().optional(),
  }),
  z.strictObject({
    action: z.literal("leave"),
    sessionKey: CHAT_SESSION,
    title: z.unknown().optional(),
    members: z.unknown().optional(),
  }),
]);
export type ManageChatParams = z.infer<typeof MANAGE_CHAT>;

/**
 * `huddle`: a face-to-face conversation among people at one place. It forms
 * when someone speaks aloud, people join by speaking into it, walking away
 * leaves it, and it dissolves when the last one goes.
 */
export type ChatKind = "direct" | "group" | "huddle";

/** Shared routing metadata only; every member's transcript remains private. */
export interface ChatConversation {
  readonly id: string;
  readonly kind: ChatKind;
  readonly members: readonly string[];
  readonly title: string | null;
  /** A huddle's place. */
  readonly placeId?: string;
  /** A huddle merged into another (by speaking aloud across groups). */
  readonly mergedInto?: string;
  /**
   * A huddle's members, by when they last joined it (sim time): someone's
   * silence there counts from joining, not from before they left and came
   * back.
   */
  readonly joinedAt?: Readonly<Record<string, number>>;
  readonly needsProjection: boolean;
}

/** A caller's address and current membership, without anyone else's history. */
export interface ChatSummary {
  readonly sessionKey: string;
  readonly kind: ChatKind;
  readonly title: string;
  readonly members: readonly string[];
  /** A huddle's place. */
  readonly placeId?: string;
}

/** Stable identities scope send retries and canonical direct conversations. */
export function messagingId(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const CHAT_ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * A new group's or huddle's id. Characters copy it into every reply, so it is
 * short: a 64-character hash cost tokens and was miscopied (2026-11-05).
 */
export function newChatId(): string {
  return Array.from(
    { length: 10 },
    () => CHAT_ID_CHARS[randomInt(CHAT_ID_CHARS.length)],
  ).join("");
}

export interface ParsedChatSession {
  readonly owner?: string;
  readonly kind: ChatKind;
  readonly peerOrGroupId: string;
}

export function parseChatSession(sessionKey: string): ParsedChatSession {
  CHAT_SESSION.parse(sessionKey);
  const match = sessionKey.match(
    /^(?:agent:((?:user:)?[a-z0-9][a-z0-9_-]*):)?chat:(direct|group|huddle):((?:user:)?[a-z0-9][a-z0-9_-]*)$/,
  );
  if (!match) throw new Error("Invalid chat session key.");
  return {
    owner: match[1],
    kind: match[2] as ChatKind,
    peerOrGroupId: match[3],
  };
}

/** Resolve context-header shorthand while rejecting another owner's ledger. */
export function ownChatSession(
  participantId: string,
  sessionKey: string,
): string {
  const parsed = parseChatSession(sessionKey);
  if (parsed.owner && parsed.owner !== participantId)
    throw new Error("Use your own chat session key.");
  return isUser(participantId)
    ? `chat:${parsed.kind}:${parsed.peerOrGroupId}`
    : `agent:${participantId}:chat:${parsed.kind}:${parsed.peerOrGroupId}`;
}

/** Direct pairs share one registry entry; groups and huddles keep their own. */
export function conversationId(
  participantId: string,
  sessionKey: string,
): string {
  const parsed = parseChatSession(sessionKey);
  if (parsed.owner && parsed.owner !== participantId)
    throw new Error("Use your own chat session key.");
  return parsed.kind === "direct"
    ? `direct:${messagingId([participantId, parsed.peerOrGroupId].sort())}`
    : `${parsed.kind}:${parsed.peerOrGroupId}`;
}

/**
 * The address a character writes: their ledger key without `agent:<id>:`, which
 * only costs tokens (the tools accept either).
 */
export function chatAddress(sessionKey: string): string {
  return sessionKey.replace(
    /^agent:(?:user:)?[a-z0-9][a-z0-9_-]*:(?=chat:)/,
    "",
  );
}

/** The shorthand address of a huddle, the same for everyone. */
export function huddleAddress(chatId: string): string {
  return `chat:huddle:${chatId.slice("huddle:".length)}`;
}

/** Project shared routing metadata into this participant's private ledger key. */
export function chatSummary(
  chat: ChatConversation,
  participantId: string,
): ChatSummary {
  const peer = chat.members.find((member) => member !== participantId);
  const suffix =
    chat.kind === "direct" ? peer : chat.id.slice(`${chat.kind}:`.length);
  if (!suffix) throw new Error("Direct chat is missing its peer.");
  return {
    sessionKey: isUser(participantId)
      ? `chat:${chat.kind}:${suffix}`
      : `agent:${participantId}:chat:${chat.kind}:${suffix}`,
    kind: chat.kind,
    title: chat.title ?? peer ?? "Group chat",
    members: [...chat.members],
    ...(chat.placeId ? { placeId: chat.placeId } : {}),
  };
}
