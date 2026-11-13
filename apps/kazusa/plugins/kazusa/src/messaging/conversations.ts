import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { PICTURE_NAME } from "../pictures.ts";

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
  name: PICTURE_NAME,
  v: z
    .string()
    .regex(/^[a-z0-9]+$/)
    .max(16),
});
export type StickerRef = z.infer<typeof STICKER_REF>;

/**
 * The face a line was said with, face to face only (§6.3): the picture's name
 * in the speaker's portrait set, and what everyone reads of it (`faceTag`), set
 * only when it changed from that speaker's previous face.
 */
export const FACE_REF = z.strictObject({
  name: PICTURE_NAME,
  seen: z.string().trim().min(1).max(4_000).optional(),
});
export type FaceRef = z.infer<typeof FACE_REF>;

const TEXT_BUBBLE = z.strictObject({
  text: TEXT(4_000),
  type: MESSAGE_TYPE.optional(),
});
/** A bubble as the speaker sends it, its face (if any) already resolved. */
const SAID_BUBBLE = TEXT_BUBBLE.extend({ face: FACE_REF.optional() });
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
export type Bubble =
  | string
  | z.infer<typeof TEXT_BUBBLE>
  | z.infer<typeof SAID_BUBBLE>
  | z.infer<typeof STICKER_BUBBLE>;

/** Absolute ceiling; the tool offers `messaging.maxBubbles`. */
const MAX_BUBBLES = 32;

/**
 * The `send_message` tool's arguments, with at most `maxBubbles` bubbles, each
 * plain text. There is nothing else to fill in: an action, a face and a sticker
 * are written into the text the way every character reads them (`written`,
 * `readAs`), and `about` says which faces and stickers this character has. A
 * field beside the text was filled as well as the text (2026-11-13). It only
 * ever says something somewhere: a chat is started by `create_group` or `talk`,
 * so the address is always required (an optional one was left out on 41% of
 * follow-up sends, 2026-11-05).
 */
export const sendMessageSchema = (maxBubbles: number, about = "") =>
  z.strictObject({
    sessionKey: CHAT_SESSION,
    messages: z.array(TEXT(4_000)).min(1).max(maxBubbles).describe(about),
  });
/** A paced multi-bubble send; the host adapter supplies its identity. */
export const SPEECH_REQUEST = CHAT_TARGET.extend({
  messages: z
    .array(z.union([TEXT(4_000), SAID_BUBBLE, STICKER_BUBBLE]))
    .min(1)
    .max(MAX_BUBBLES),
  requestId: z.string().trim().min(1).max(128),
}).refine(...HAS_TARGET);

/** A bubble's words and type, its sticker if it is one, and its face. */
export function bubbleOf(bubble: Bubble): {
  readonly text: string;
  readonly type: MessageType;
  readonly sticker?: StickerRef;
  readonly face?: FaceRef;
} {
  if (typeof bubble === "string") return { text: bubble, type: "speech" };
  if (bubble.type === "sticker") return bubble;
  return {
    text: bubble.text,
    type: bubble.type ?? "speech",
    ...("face" in bubble && bubble.face ? { face: bubble.face } : {}),
  };
}

/**
 * A bubble that opens and closes with one asterisk: `*sets the bag down*`.
 * Asterisks inside are part of what is done; `**bold**` is not an action.
 */
const ACTION = /^\*(?![\s*])(.+)(?<![\s*])\*$/s;
/** `[face=annoyed]` at the start of a bubble. */
const FACE = /^\[face=([^\][]+)\]\s*/;
/** A bubble that is only `[sticker=maid-happy]`. */
const STICKER = /^\[sticker=([^\][]+)\]$/;

/** A bubble as a character wrote it: something said or done, or a sticker. */
export type Written =
  | {
      readonly text: string;
      readonly type?: "action";
      /** One of the writer's moods. */
      readonly face?: string;
    }
  | { readonly sticker: string };

/**
 * What a character meant by one bubble of text, the inverse of `readAs` and
 * `heardAs`, so whatever they read they can write:
 *
 * - A bubble that is only `[sticker=<name>]` is a sticker;
 * - `[face=<mood>]` opening a bubble is the face the line is said with when it is
 *   one of `moods`, and is not said either way;
 * - `aloud`, what then opens and closes with an asterisk is an action, whole.
 *
 * Only these exact forms, which the skills ask for. Anything else is speech as
 * typed: a bubble that mixes them is the writer's to get right, not ours to
 * guess at. A name may be written with spaces or `_` for `-`.
 */
export function written(
  line: string,
  moods: readonly string[] = [],
  aloud = true,
): Written {
  const name = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
  const whole = line.trim();
  const sticker = STICKER.exec(whole)?.[1];
  if (sticker !== undefined) return { sticker: name(sticker) };
  const tag = FACE.exec(whole);
  const text = tag ? whole.slice(tag[0].length) : line;
  // A face with nothing said or done is not a face shown: as typed.
  if (!text) return { text: line };
  const mood = tag?.[1] === undefined ? undefined : name(tag[1]);
  const action = aloud ? ACTION.exec(text.trim())?.[1] : undefined;
  return {
    ...(action === undefined ? { text } : { text: action, type: "action" }),
    ...(mood !== undefined && moods.includes(mood) ? { face: mood } : {}),
  };
}

/**
 * A line as characters read it, which is exactly how they write one: an action
 * as `*text*`, a sticker as `[sticker=<name>]`. Characters copy what they read,
 * so nothing is shown that `written` would not take back as the same thing.
 */
export function readAs(params: {
  readonly text: string;
  readonly type?: MessageType;
  readonly sticker?: StickerRef;
}): string {
  if (params.type === "action") return `*${params.text}*`;
  if (params.type === "sticker")
    return `[sticker=${params.sticker?.name ?? params.text}]`;
  return params.text;
}
/** A face as it is read and written, before the line it is shown with. */
export const faceTag = (mood: string): string => `[face=${mood}]`;
/**
 * A line as its listeners read it: the speaker's face when it changed, then
 * `readAs`. The face stays outside an action's asterisks.
 */
export function heardAs(params: {
  readonly text: string;
  readonly type?: MessageType;
  readonly sticker?: StickerRef;
  readonly face?: FaceRef;
}): string {
  const seen = params.face?.seen;
  const line = readAs(params);
  return seen === undefined ? line : `${seen} ${line}`;
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
  face: FACE_REF.optional(),
})
  .refine(...HAS_TARGET)
  .refine((params) => (params.type === "sticker") === Boolean(params.sticker), {
    message: "A sticker message carries its sticker, and only it does.",
  })
  .refine((params) => params.type !== "sticker" || !params.face, {
    message: "A sticker has no face of its own.",
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
