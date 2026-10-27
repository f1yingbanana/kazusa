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
/* Read model: world + clock (PROPOSED — GET /kazusa/world, POST /kazusa/clock) */
/* ========================================================================== */

/** A slice of the read model that resolves to live/mock/unavailable on its own. */
export const DomainSchema = z.enum([
  "clock",
  "characters",
  "status",
  "chats",
  "observe",
  "timeline",
  "places",
  "location",
  "relationships",
  "attention",
  "desires",
]);
export type Domain = z.infer<typeof DomainSchema>;
export const DOMAINS = DomainSchema.options;

export const CapabilitySchema = z.enum(["live", "unavailable"]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** Clock anchor. Clients interpolate `simTime + (now - updatedAt) * speed`. */
export const ClockStateSchema = z.object({
  /** Epoch-ms simulation time at `updatedAt`. */
  simTime: z.number(),
  /** Multiplier; 0 means paused. */
  speed: z.number().nonnegative(),
  /** Epoch-ms server wall time when this anchor was taken. */
  updatedAt: z.number(),
});
export type ClockState = z.infer<typeof ClockStateSchema>;

export const WorldMetaSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  /** Hex color from `shared/wiki/world.md` frontmatter. */
  accent: z.string().optional(),
});
export type WorldMeta = z.infer<typeof WorldMetaSchema>;

/** GET /kazusa/world. Missing capability keys mean "unavailable". */
export const WorldResponseSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  serverNow: z.number(),
  clock: ClockStateSchema,
  capabilities: z.partialRecord(DomainSchema, CapabilitySchema),
  world: WorldMetaSchema,
});
export type WorldResponse = z.infer<typeof WorldResponseSchema>;

/** POST /kazusa/clock. Forward-only; observer lens only. */
export const ClockActionPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_speed"),
    speed: z.number().nonnegative(),
  }),
  z.object({
    action: z.literal("advance"),
    minutes: z.number().int().positive(),
  }),
]);
export type ClockActionPayload = z.infer<typeof ClockActionPayloadSchema>;

export const ClockResponseSchema = z.object({ clock: ClockStateSchema });
export type ClockResponse = z.infer<typeof ClockResponseSchema>;

/* ========================================================================== */
/* Read model: characters (PROPOSED — replaces GET /kazusa/agents)            */
/* ========================================================================== */

/** agent = has a workspace + roster entry; npc = World Wiki card only. */
export const CharacterKindSchema = z.enum(["agent", "player", "npc"]);
export type CharacterKind = z.infer<typeof CharacterKindSchema>;

/** Taskman `ActiveTask`, with ISO times converted to epoch-ms sim time. */
export const TaskSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  startedAt: z.number(),
  endAt: z.number(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

/** Perception's read-only brain state. Never derived from task text. */
export const BrainStateSchema = z.enum(["idle", "thinking", "unknown"]);
export type BrainState = z.infer<typeof BrainStateSchema>;

/** Transient, structured state. Sent as full replacements per character. */
export const CharacterStatusSchema = z.object({
  task: TaskSummarySchema.optional(),
  brain: BrainStateSchema,
  /** Chat ids the character is currently composing in. */
  composingIn: z.array(z.string()),
  /** Pending admitted stimuli. */
  queued: z.number().int().nonnegative(),
});
export type CharacterStatus = z.infer<typeof CharacterStatusSchema>;

export const CharacterSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: CharacterKindSchema,
  avatarUrl: z.string().optional(),
  occupation: z.string().optional(),
  affiliation: z.string().optional(),
  aliases: z.array(z.string()),
  /** Absent for NPCs. */
  status: CharacterStatusSchema.optional(),
});
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;

/** GET /kazusa/characters */
export const CharactersResponseSchema = z.object({
  characters: z.array(CharacterSummarySchema),
});
export type CharactersResponse = z.infer<typeof CharactersResponseSchema>;

/** GET /kazusa/character?id= — frontmatter fields as JSON, body verbatim. */
export const CharacterDetailSchema = CharacterSummarySchema.extend({
  role: z.string().optional(),
  personalityTraits: z.array(z.string()),
  /** Rendered verbatim. Never mined for fields. */
  bodyMarkdown: z.string().optional(),
});
export type CharacterDetail = z.infer<typeof CharacterDetailSchema>;

export const CharacterDetailResponseSchema = z.object({
  character: CharacterDetailSchema,
});
export type CharacterDetailResponse = z.infer<
  typeof CharacterDetailResponseSchema
>;

/* ========================================================================== */
/* Read model: world journal (PROPOSED — src/journal/, GET /kazusa/timeline)  */
/* ========================================================================== */

const JournalBase = {
  /** Monotonic, assigned at append. Orders events; timestamps don't. */
  seq: z.number().int().nonnegative(),
  /** Epoch-ms sim time at the mutation. */
  simTime: z.number(),
  /** Character ids involved (filter key). */
  actors: z.array(z.string()),
  chatId: z.string().optional(),
  placeId: z.string().optional(),
};

export const TaskStartedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("task.started"),
  payload: z.object({
    taskId: z.string(),
    type: z.string(),
    description: z.string(),
    /** Minutes. */
    duration: z.number(),
    endAt: z.number(),
    summary: z.string().optional(),
    monologue: z.string().optional(),
    replacedTaskId: z.string().optional(),
  }),
});

export const TaskDelayedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("task.delayed"),
  payload: z.object({
    taskId: z.string(),
    additionalMinutes: z.number(),
    endAt: z.number(),
    reason: z.string().optional(),
    monologue: z.string().optional(),
  }),
});

export const MessageSentEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("message.sent"),
  payload: z.object({
    messageId: z.string(),
    sequence: z.number(),
    senderId: z.string(),
    preview: z.string(),
  }),
});

export const ChatCreatedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("chat.created"),
  payload: z.object({
    type: ChatTypeSchema,
    title: z.string(),
    members: z.array(z.string()),
  }),
});

export const ChatRenamedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("chat.renamed"),
  payload: z.object({ title: z.string() }),
});

export const ChatMembersChangedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("chat.members_changed"),
  payload: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
});

export const ClockChangedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("clock.changed"),
  payload: z.object({
    speed: z.number().optional(),
    advancedMinutes: z.number().optional(),
  }),
});

export const JournalEventSchema = z.discriminatedUnion("kind", [
  TaskStartedEventSchema,
  TaskDelayedEventSchema,
  MessageSentEventSchema,
  ChatCreatedEventSchema,
  ChatRenamedEventSchema,
  ChatMembersChangedEventSchema,
  ClockChangedEventSchema,
]);
export type JournalEvent = z.infer<typeof JournalEventSchema>;
export type JournalKind = JournalEvent["kind"];
export type JournalEventOf<K extends JournalKind> = Extract<
  JournalEvent,
  { kind: K }
>;
export const JOURNAL_KINDS = JournalEventSchema.options.map(
  (option) => option.shape.kind.value,
) as JournalKind[];

/**
 * GET /kazusa/timeline. List params are comma-separated on the wire. `before`
 * pages newest-first; `after` returns ascending for gap catch-up.
 */
export const TimelineQuerySchema = z.object({
  before: z.number().int().optional(),
  after: z.number().int().optional(),
  limit: z.number().int().positive().max(500).optional(),
  actors: z.array(z.string()).optional(),
  kinds: z.array(z.enum(JOURNAL_KINDS as [JournalKind, ...JournalKind[]])).optional(),
  chats: z.array(z.string()).optional(),
});
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export const TimelineResponseSchema = z.object({
  events: z.array(JournalEventSchema),
  /** Pass as `before` for the next (older) page. */
  nextCursor: z.number().int().optional(),
  hasMore: z.boolean(),
});
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

/** GET /kazusa/timeline/histogram (from, to, bucketMinutes + timeline filters). */
export const TimelineHistogramResponseSchema = z.object({
  buckets: z.array(
    z.object({
      start: z.number(),
      counts: z.partialRecord(
        z.enum(JOURNAL_KINDS as [JournalKind, ...JournalKind[]]),
        z.number().int().nonnegative(),
      ),
    }),
  ),
});
export type TimelineHistogramResponse = z.infer<
  typeof TimelineHistogramResponseSchema
>;

/* ========================================================================== */
/* Observer SSE events (PROPOSED — GET /kazusa/events?scope=observer)          */
/* ========================================================================== */

export const StatusStreamEventSchema = z.object({
  type: z.literal("status"),
  characterId: z.string(),
  status: CharacterStatusSchema,
});
export type StatusStreamEvent = z.infer<typeof StatusStreamEventSchema>;

export const JournalStreamEventSchema = z.object({
  type: z.literal("journal"),
  event: JournalEventSchema,
});
export type JournalStreamEvent = z.infer<typeof JournalStreamEventSchema>;

export const ClockStreamEventSchema = z.object({
  type: z.literal("clock"),
  clock: ClockStateSchema,
});
export type ClockStreamEvent = z.infer<typeof ClockStreamEventSchema>;

/** `connected` with the observer-scope additions (journal high-water, status seed). */
export const ObserverConnectedEventSchema = ConnectedEventSchema.extend({
  journalSeq: z.number().int().optional(),
  statuses: z.record(z.string(), CharacterStatusSchema).optional(),
});

export const StreamEventSchema = z.discriminatedUnion("type", [
  MessageStreamEventSchema,
  TypingStreamEventSchema,
  ObserverConnectedEventSchema,
  ChatsStreamEventSchema,
  StatusStreamEventSchema,
  JournalStreamEventSchema,
  ClockStreamEventSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StreamEventType = StreamEvent["type"];
export type StreamEventOf<T extends StreamEventType> = Extract<
  StreamEvent,
  { type: T }
>;

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

/** Parses any scope's SSE payload; unknown or malformed events return null. */
export function parseStreamEvent(raw: unknown): StreamEvent | null {
  try {
    const result = StreamEventSchema.safeParse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
