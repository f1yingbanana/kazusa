import { z } from "zod";

/* ========================================================================== */
/* Core Entities & Wire Schemas                                               */
/* ========================================================================== */

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const ChatTypeSchema = z.enum(["direct", "group"]);
export type ChatType = z.infer<typeof ChatTypeSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  sequence: z.number(),
  senderId: z.string(),
  senderName: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  type: ChatTypeSchema,
  name: z.string(),
  members: z.array(z.string()),
  lastMessage: ChatMessageSchema.pick({
    text: true,
    timestamp: true,
    sequence: true,
  }).optional(),
});
export type Chat = z.infer<typeof ChatSchema>;

/* ========================================================================== */
/* HTTP Endpoint Request & Response Schemas                                    */
/* ========================================================================== */

/** GET /kazusa/agents */
export const AgentsResponseSchema = z.object({
  agents: z.array(AgentSchema),
});
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;

/** GET /kazusa/chats */
export const ChatsResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
  }),
  chats: z.array(ChatSchema),
});
export type ChatsResponse = z.infer<typeof ChatsResponseSchema>;

/** GET /kazusa/messages */
export const MessagesQuerySchema = z.object({
  chatId: z.string(),
  before: z.number().nullable().optional(),
  limit: z.number().optional(),
});
export type MessagesQuery = z.infer<typeof MessagesQuerySchema>;

export const MessagesResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
  nextCursor: z.number().optional(),
  hasMore: z.boolean(),
});
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;

/** POST /kazusa/send */
export const SendPayloadSchema = z
  .object({
    requestId: z.string().trim().min(1),
    text: z.string().min(1),
    sessionKey: z.string().optional(),
    members: z.array(z.string()).optional(),
    title: z.string().nullable().optional(),
  })
  .refine((data) => Boolean(data.sessionKey) || Boolean(data.members?.length), {
    message: "Must provide either sessionKey or members.",
  });
export type SendPayload = z.infer<typeof SendPayloadSchema>;

export const SendResponseSchema = z.object({
  chatId: z.string(),
  sessionKey: z.string(),
  message: ChatMessageSchema,
  status: z.enum(["delivered", "pending"]),
});
export type SendResponse = z.infer<typeof SendResponseSchema>;

/** POST /kazusa/chats/manage */
export const ManageChatPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    sessionKey: z.string(),
    action: z.literal("rename"),
    title: z.string().trim().min(1),
  }),
  z.object({
    sessionKey: z.string(),
    action: z.literal("add_members"),
    members: z.array(z.string()).min(1),
  }),
  z.object({
    sessionKey: z.string(),
    action: z.literal("remove_members"),
    members: z.array(z.string()).min(1),
  }),
  z.object({
    sessionKey: z.string(),
    action: z.literal("leave"),
  }),
]);
export type ManageChatPayload = z.infer<typeof ManageChatPayloadSchema>;

export const ManageChatResponseSchema = z.object({
  chat: ChatSchema,
});
export type ManageChatResponse = z.infer<typeof ManageChatResponseSchema>;

/** POST /kazusa/typing */
export const TypingPayloadSchema = z.object({
  sessionKey: z.string(),
  isTyping: z.boolean(),
});
export type TypingPayload = z.infer<typeof TypingPayloadSchema>;

/* ========================================================================== */
/* Realtime Server-Sent Events (GET /kazusa/events)                           */
/* ========================================================================== */

export const TypingStreamEventSchema = z.object({
  type: z.literal("typing"),
  chatId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  isTyping: z.boolean(),
  expiresAt: z.number().optional(),
});
export type TypingStreamEvent = z.infer<typeof TypingStreamEventSchema>;

export const MessageStreamEventSchema = z.object({
  type: z.literal("message"),
  chatId: z.string(),
  message: ChatMessageSchema,
});
export type MessageStreamEvent = z.infer<typeof MessageStreamEventSchema>;

export const ConnectedEventSchema = z.object({
  type: z.literal("connected"),
  typing: z.array(TypingStreamEventSchema),
});
export type ConnectedEvent = z.infer<typeof ConnectedEventSchema>;

export const ChatsStreamEventSchema = z.object({
  type: z.literal("chats"),
});
export type ChatsStreamEvent = z.infer<typeof ChatsStreamEventSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  MessageStreamEventSchema,
  TypingStreamEventSchema,
  ConnectedEventSchema,
  ChatsStreamEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

/* ========================================================================== */
/* Client-side Parsing Helpers                                                */
/* ========================================================================== */

export function parseChatStreamEvent(raw: unknown): ChatStreamEvent | null {
  try {
    const result = ChatStreamEventSchema.safeParse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
