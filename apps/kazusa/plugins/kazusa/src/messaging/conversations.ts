import { createHash } from "node:crypto";
import { z } from "zod";

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
    /^(?:agent:(?:user:)?[a-z0-9][a-z0-9_-]*:)?chat:(?:direct|group):(?:user:)?[a-z0-9][a-z0-9_-]*$/,
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
  sessionKey: CHAT_SESSION.optional().describe(
    "Your chat address, from context or list_chats (e.g. chat:direct:bob); omit members and title.",
  ),
  members: MEMBERS.optional().describe(
    "Other configured agent IDs to start a chat with; you are included automatically. Omit if sessionKey is provided.",
  ),
  title: TITLE.nullable()
    .optional()
    .describe(
      "Optional new group title. One other member without a title reuses the direct chat.",
    ),
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

const BUBBLES = z
  .array(TEXT(4_000))
  .min(1)
  .max(8)
  .describe(
    "Your character's chat bubbles, in order, without speaker labels. They are typed and sent one at a time; you may be interrupted before later ones are sent.",
  );
export const SEND_MESSAGE = CHAT_TARGET.extend({ messages: BUBBLES }).refine(
  ...HAS_TARGET,
);
/** A paced multi-bubble send; the host adapter supplies its identity. */
export const SPEECH_REQUEST = CHAT_TARGET.extend({
  messages: BUBBLES,
  requestId: z.string().trim().min(1).max(128),
}).refine(...HAS_TARGET);
export type SpeechParams = z.infer<typeof SPEECH_REQUEST>;
/**
 * One canonical message. Delivery identity is supplied by the host adapter,
 * never the model.
 */
export const DELIVERY_REQUEST = CHAT_TARGET.extend({
  text: TEXT(32_000),
  requestId: z.string().trim().min(1).max(128),
}).refine(...HAS_TARGET);
export type SendMessageParams = z.infer<typeof DELIVERY_REQUEST>;

export const LIST_CHATS = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .optional()
    .describe(
      "Filter your chats by title, member ID or session key; omit to list all current memberships.",
    ),
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

/** Shared routing metadata only; every member's transcript remains private. */
export interface ChatConversation {
  readonly id: string;
  readonly kind: "direct" | "group";
  readonly members: readonly string[];
  readonly title: string | null;
  /**
   * Detect conflicting retries of a group creation before its first send
   * commits.
   */
  readonly creationFingerprint?: string;
  readonly needsProjection: boolean;
}

/** A caller's address and current membership, without anyone else's history. */
export interface ChatSummary {
  readonly sessionKey: string;
  readonly kind: "direct" | "group";
  readonly title: string;
  readonly members: readonly string[];
}

/** Stable identities scope send retries and canonical direct conversations. */
export function messagingId(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export interface ParsedChatSession {
  readonly owner?: string;
  readonly kind: "direct" | "group";
  readonly peerOrGroupId: string;
}

export function parseChatSession(sessionKey: string): ParsedChatSession {
  CHAT_SESSION.parse(sessionKey);
  const match = sessionKey.match(
    /^(?:agent:((?:user:)?[a-z0-9][a-z0-9_-]*):)?chat:(direct|group):((?:user:)?[a-z0-9][a-z0-9_-]*)$/,
  );
  if (!match) throw new Error("Invalid chat session key.");
  return {
    owner: match[1],
    kind: match[2] as "direct" | "group",
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

/** Direct pairs share one registry entry; groups retain their opaque identity. */
export function conversationId(
  participantId: string,
  sessionKey: string,
): string {
  const parsed = parseChatSession(sessionKey);
  if (parsed.owner && parsed.owner !== participantId)
    throw new Error("Use your own chat session key.");
  return parsed.kind === "direct"
    ? `direct:${messagingId([participantId, parsed.peerOrGroupId].sort())}`
    : `group:${parsed.peerOrGroupId}`;
}

/** Project shared routing metadata into this participant's private ledger key. */
export function chatSummary(
  chat: ChatConversation,
  participantId: string,
): ChatSummary {
  const peer = chat.members.find((member) => member !== participantId);
  const suffix = chat.kind === "direct" ? peer : chat.id.slice("group:".length);
  if (!suffix) throw new Error("Direct chat is missing its peer.");
  return {
    sessionKey: isUser(participantId)
      ? `chat:${chat.kind}:${suffix}`
      : `agent:${participantId}:chat:${chat.kind}:${suffix}`,
    kind: chat.kind,
    title: chat.title ?? peer ?? "Group chat",
    members: [...chat.members],
  };
}
