import { z } from "zod";

/* ========================================================================== */
/* Core Entities & Wire Schemas                                               */
/* ========================================================================== */

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  isSystemAgent: z.boolean().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** `huddle`: a face-to-face conversation at a place; it ends when all leave. */
export const ChatTypeSchema = z.enum(["direct", "group", "huddle"]);
export type ChatType = z.infer<typeof ChatTypeSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  sequence: z.number(),
  senderId: z.string(),
  senderName: z.string(),
  /** Plain text; for an action, what the sender does (render as done). */
  text: z.string(),
  /** Absent: speech. An action is done where the sender is, in third person. */
  type: z.enum(["speech", "action"]).optional(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  type: ChatTypeSchema,
  name: z.string(),
  members: z.array(z.string()),
  /** Huddles only: the place where the conversation is happening. */
  placeId: z.string().optional(),
  lastMessage: ChatMessageSchema.pick({
    text: true,
    timestamp: true,
    sequence: true,
    type: true,
  })
    .extend(
      ChatMessageSchema.pick({ senderId: true, senderName: true }).partial()
        .shape,
    )
    .optional(),
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
    /** Absent: speech. Actions are kept only in huddles (face to face). */
    type: z.enum(["speech", "action"]).optional(),
    /**
     * With `members`: say it face to face to people where you are. They join
     * your huddle there with anyone they were talking with, or you join
     * theirs.
     */
    aloud: z.boolean().optional(),
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
  "stage",
  "models",
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
/* Read model: models (GET /kazusa/models, POST /kazusa/model|thinking)       */
/* ========================================================================== */

/** `provider/model`, as OpenClaw writes model refs. */
export const ModelRefSchema = z.string().regex(/^[^/\s]+\/\S+$/);

/**
 * OpenClaw's reasoning ladder (`/think`), without `ultra`: that is a harness
 * mode (planning, sub-agents), not how hard the model reasons.
 */
export const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "adaptive",
  "max",
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

/**
 * A level a model accepts; `label` is the provider's word (Z.AI calls `low`
 * "on").
 */
export const ThinkingOptionSchema = z.object({
  id: ThinkingLevelSchema,
  label: z.string(),
});
export type ThinkingOption = z.infer<typeof ThinkingOptionSchema>;

/** One model from the Gateway's catalog (`models.list`). */
export const ModelOptionSchema = z.object({
  ref: ModelRefSchema,
  provider: z.string(),
  id: z.string(),
  name: z.string(),
  /** Display name from `agents.defaults.models`. */
  alias: z.string().optional(),
  /** Listed in `agents.defaults.models`, the world's shortlist. */
  pinned: z.boolean(),
  /** False when the provider has no working credentials right now. */
  available: z.boolean(),
  unavailableReason: z
    .enum(["missing-auth", "auth-failed", "cooldown"])
    .optional(),
  contextWindow: z.number().int().optional(),
  reasoning: z.boolean().optional(),
  /** Levels this model accepts, weakest first. Empty: it can't be tuned. */
  thinkingLevels: z.array(ThinkingOptionSchema),
  /** What the model runs at when no level is configured. */
  thinkingDefault: ThinkingLevelSchema.optional(),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const ModelProviderStatusSchema = z.object({
  provider: z.string(),
  status: z.enum(["ready", "auth-rejected", "unavailable"]),
});
export type ModelProviderStatus = z.infer<typeof ModelProviderStatusSchema>;

/** GET /kazusa/models. `?refresh=1` asks providers for their catalogs again. */
export const ModelsResponseSchema = z.object({
  /**
   * The model every character runs on: the one picked here, else `configured`.
   * Kazusa applies it per turn, not through `openclaw.json`.
   */
  current: ModelRefSchema.optional(),
  /** `agents.defaults.model.primary`, used until a model is picked. */
  configured: ModelRefSchema.optional(),
  /**
   * The reasoning level picked for every character. Absent: each model runs at
   * its own default. A level the model lacks is remapped by OpenClaw to the
   * nearest one it has.
   */
  thinking: ThinkingLevelSchema.optional(),
  models: z.array(ModelOptionSchema),
  providers: z.array(ModelProviderStatusSchema),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

/** POST /kazusa/model. Sets the model for every character. */
export const ModelSelectPayloadSchema = z.object({ ref: ModelRefSchema });
export type ModelSelectPayload = z.infer<typeof ModelSelectPayloadSchema>;

export const ModelSelectResponseSchema = z.object({ current: ModelRefSchema });
export type ModelSelectResponse = z.infer<typeof ModelSelectResponseSchema>;

/** POST /kazusa/thinking. `null` goes back to each model's own default. */
export const ThinkingSelectPayloadSchema = z.object({
  level: ThinkingLevelSchema.nullable(),
});
export type ThinkingSelectPayload = z.infer<typeof ThinkingSelectPayloadSchema>;

export const ThinkingSelectResponseSchema = z.object({
  thinking: ThinkingLevelSchema.optional(),
});
export type ThinkingSelectResponse = z.infer<
  typeof ThinkingSelectResponseSchema
>;

/* ========================================================================== */
/* Read model: characters (PROPOSED — replaces GET /kazusa/agents)            */
/* ========================================================================== */

/** Agent = has a workspace + roster entry; npc = World Wiki card only. */
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
  /**
   * Offstage characters are not simulated: no turns, no place in the world.
   * Texts to them wait (counted in `queued`) until they come back.
   */
  onstage: z.boolean(),
  /**
   * Sim time they went offstage, when known. Their desires stand still from
   * then: clients compute levels at this moment, not now.
   */
  offstageSince: z.number().optional(),
});
export type CharacterStatus = z.infer<typeof CharacterStatusSchema>;

export const CharacterSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: CharacterKindSchema,
  isSystemAgent: z.boolean().optional(),
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

/**
 * POST /kazusa/character/stage. Sends characters off or brings them back, one
 * group in one request. Answers with each character's new status.
 */
export const StagePayloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  onstage: z.boolean(),
});
export type StagePayload = z.infer<typeof StagePayloadSchema>;

export const StageResponseSchema = z.object({
  statuses: z.record(z.string(), CharacterStatusSchema),
});
export type StageResponse = z.infer<typeof StageResponseSchema>;

/* ========================================================================== */
/* Read model: desires (GET /kazusa/desires, SSE `desires`)                   */
/* ========================================================================== */

/** One step of the world's level-to-state mapping (ascending by `min`). */
export const DesireStateDefSchema = z.object({
  name: z.string(),
  /** A level is in the last state whose `min` it reaches. */
  min: z.number(),
  /** Where a task targeting this state settles. */
  level: z.number(),
});
export type DesireStateDef = z.infer<typeof DesireStateDefSchema>;

export const DesireDefinitionSchema = z.object({
  /** Stable key, shown to the LLM verbatim; clients may prettify it. */
  name: z.string(),
  /** The semantic contract given to the LLM. */
  description: z.string(),
  /** Default points lost per simulated hour. */
  drain: z.number().nonnegative(),
});
export type DesireDefinition = z.infer<typeof DesireDefinitionSchema>;

/** The world's desire catalog (`plugins.entries.kazusa.config.desires`). */
export const DesiresConfigSchema = z.object({
  states: z.array(DesireStateDefSchema).min(1),
  /** State an unseen desire starts in. */
  initial: z.string(),
  catalog: z.array(DesireDefinitionSchema),
});
export type DesiresConfig = z.infer<typeof DesiresConfigSchema>;

/** A task's pull on one desire: move toward `target`, then hold there. */
export const DesireEffectSchema = z.object({
  target: z.number(),
  /** Points per simulated hour, always non-negative. */
  rate: z.number().nonnegative(),
});
export type DesireEffect = z.infer<typeof DesireEffectSchema>;

/**
 * One character's desires in closed form, exact at `anchorAt`. Levels at any
 * later sim time are a pure function of this record, so clients compute them
 * locally instead of polling. Changes only on task transitions and operator
 * configuration.
 */
export const DesireRecordSchema = z.object({
  /** Epoch-ms sim time at which `levels` are exact. */
  anchorAt: z.number(),
  /** Levels 0..100 at `anchorAt`, keyed by catalog name. */
  levels: z.record(z.string(), z.number()),
  /** The current task's declared effects, applying until `until`. */
  effects: z
    .object({
      taskId: z.string(),
      until: z.number(),
      byDesire: z.record(z.string(), DesireEffectSchema),
    })
    .optional(),
  /** Sparse per-character drain overrides (points/hour). */
  drain: z.record(z.string(), z.number()),
});
export type DesireRecord = z.infer<typeof DesireRecordSchema>;

/**
 * GET /kazusa/desires. Simulated characters without a record are still in the
 * catalog's `initial` state and do not drain until their first task.
 */
export const DesiresResponseSchema = z.object({
  config: DesiresConfigSchema,
  records: z.record(z.string(), DesireRecordSchema),
});
export type DesiresResponse = z.infer<typeof DesiresResponseSchema>;

/* ========================================================================== */
/* Read model: places + locations (GET /kazusa/places, GET /kazusa/locations) */
/* ========================================================================== */

export const PlaceWaySchema = z.object({
  /** Free-form (`walk`, `bike`, `monorail`); `walk` reads as on foot. */
  by: z.string(),
  minutes: z.number(),
});

/** A World Wiki place. Places form a tree through `parent`. */
export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  parent: z.string().optional(),
  summary: z.string(),
  /** Walking minutes to the parent's open space. */
  entryMinutes: z.number(),
  /** Two-way; declared once. The first way is the usual one. */
  connections: z.array(
    z.object({
      to: z.string(),
      ways: z.array(PlaceWaySchema),
      note: z.string().optional(),
    }),
  ),
  bodyMarkdown: z.string(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Places in tree order: each area, then its places by name. */
export const PlacesResponseSchema = z.object({ places: z.array(PlaceSchema) });
export type PlacesResponse = z.infer<typeof PlacesResponseSchema>;

/**
 * A participant's position. Clients compute it at any sim time: at `placeId`
 * until `trip.departAt`, passing `trip.legs` in order, at `trip.to` from
 * `trip.arriveAt`.
 */
export const LocationRecordSchema = z.object({
  placeId: z.string(),
  /** Sim ms when they got there. */
  since: z.number(),
  trip: z
    .object({
      taskId: z.string(),
      /**
       * A walk over to do something there: what it was for and the minutes
       * planned for it. The lease checks in on arrival.
       */
      purpose: z
        .object({ description: z.string(), minutes: z.number() })
        .optional(),
      to: z.string(),
      departAt: z.number(),
      arriveAt: z.number(),
      legs: z.array(z.object({ placeId: z.string(), at: z.number() })),
      usualMinutes: z.number(),
    })
    .optional(),
  /**
   * People this participant has noticed since getting here; cleared when they
   * move. Observer-only: a Player lens redacts it.
   */
  noticed: z.array(z.string()).optional(),
});
export type LocationRecord = z.infer<typeof LocationRecordSchema>;

/** Every placed character's and the player's record, homes included. */
export const LocationsResponseSchema = z.object({
  records: z.record(z.string(), LocationRecordSchema),
});
export type LocationsResponse = z.infer<typeof LocationsResponseSchema>;

/**
 * POST /kazusa/move: the player goes straight to a place (no trip; the player
 * has no tasks). They leave their huddles where they were, and those there may
 * notice them come and go, as with any move. Who moves comes from config.
 */
export const MovePayloadSchema = z.object({ placeId: z.string().min(1) });
export type MovePayload = z.infer<typeof MovePayloadSchema>;

export const MoveResponseSchema = z.object({ record: LocationRecordSchema });
export type MoveResponse = z.infer<typeof MoveResponseSchema>;

/* ========================================================================== */
/* Read model: assembled brain context (GET /kazusa/context?id=)              */
/* ========================================================================== */

/**
 * The situation message one brain turn was given, exactly as the model saw it
 * (time, activity, Where you are, feelings, chats awaiting a reply). Earlier
 * turns are in the transcript; skills are files.
 */
export const AssembledContextSchema = z.object({
  simTime: z.number(),
  situation: z.string(),
  /** Whether the `in-person` skill was attached. */
  inPerson: z.boolean(),
  estimatedTokens: z.number(),
});
export type AssembledContext = z.infer<typeof AssembledContextSchema>;

/** A character's last turns' contexts, newest first. */
export const ContextResponseSchema = z.object({
  contexts: z.array(AssembledContextSchema),
});
export type ContextResponse = z.infer<typeof ContextResponseSchema>;

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
    /** Location: the place id where the activity happens (a trip's destination). */
    where: z.string().optional(),
    /** Location: the character's own words for a spot within `where`. */
    spot: z.string().optional(),
    /** Location: a trip toward somewhere off the map; they stayed at `where`. */
    unknown: z.string().optional(),
    /** Location, trips only: origin place id, arrival, and the usual route time. */
    from: z.string().optional(),
    arriveAt: z.number().optional(),
    usualMinutes: z.number().optional(),
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
    /** Location, trips only: the new arrival time. */
    arriveAt: z.number().optional(),
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

/**
 * Perception's attention verdict for one stimulus batch: why a character
 * replied late, deferred, or never saw a message. Observer-only; never replayed
 * into any character's context.
 */
export const AttentionDecidedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("attention.decided"),
  payload: z.object({
    /** `wake_decision` for an idle brain, `attention_allocation` for a busy one. */
    question: z.enum(["wake_decision", "attention_allocation"]),
    action: z.enum(["STEER", "QUEUE_NEXT", "DEFER", "IGNORE"]),
    /**
     * `model` asked the decision model; `automatic` skipped it (deadlines and
     * idle check-ins); `fallback` admitted because the model was unavailable.
     */
    source: z.enum(["model", "automatic", "fallback"]),
    /** Sim ms before a delayed wake is noticed; 0 when immediate. */
    delayMs: z.number().nonnegative(),
    /** The model's categorical answer. */
    choice: z.string().optional(),
    /** The model's response-latency score, mapped to `delayMs`. */
    latencyScore: z.number().optional(),
    /** Why a fallback was taken. */
    note: z.string().optional(),
    stimulusIds: z.array(z.string()),
    taskId: z.string().optional(),
  }),
});

/**
 * Location's `notice` judgment came out yes: the observer (`actors[0]`) saw
 * `subjects` (a whole group, when they were talking together). Written to the
 * observer's `:tasks` ledger. Word, probability and roll are observer-only.
 */
export const LocationNoticedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("location.noticed"),
  payload: z.object({
    subjects: z.array(z.string()),
    placeId: z.string(),
    /**
     * `arrive`: the observer walked in on them; `comes`: they walked in on the
     * observer; `cross`: paths crossed here; `meet`: passed going opposite ways
     * between `placeId` and `between`.
     */
    moment: z.enum(["arrive", "comes", "cross", "meet"]),
    between: z.string().optional(),
    /** The subjects' huddle address, when they were talking together. */
    huddle: z.string().optional(),
    word: z.string(),
    probability: z.number(),
    roll: z.number(),
    source: z.string(),
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
  AttentionDecidedEventSchema,
  LocationNoticedEventSchema,
]);
export type JournalEvent = z.infer<typeof JournalEventSchema>;
export type JournalKind = JournalEvent["kind"];
export type JournalEventOf<K extends JournalKind> = Extract<
  JournalEvent,
  { kind: K }
>;
export const JOURNAL_KINDS = JournalEventSchema.options.map<JournalKind>(
  (option) => option.shape.kind.value,
);

/**
 * GET /kazusa/timeline. List params are comma-separated on the wire. `before`
 * pages newest-first; `after` returns ascending for gap catch-up.
 */
export const TimelineQuerySchema = z.object({
  before: z.number().int().optional(),
  after: z.number().int().optional(),
  limit: z.number().int().positive().max(500).optional(),
  actors: z.array(z.string()).optional(),
  kinds: z
    .array(z.enum(JOURNAL_KINDS as [JournalKind, ...JournalKind[]]))
    .optional(),
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

/** A character's re-anchored desire record (full replacement for that id). */
export const DesiresStreamEventSchema = z.object({
  type: z.literal("desires"),
  characterId: z.string(),
  record: DesireRecordSchema,
});
export type DesiresStreamEvent = z.infer<typeof DesiresStreamEventSchema>;

/**
 * A participant's new closed-form position record (full replacement for that
 * id): on every task-lease move, arrival, operator placement and change to who
 * they have noticed.
 */
export const LocationStreamEventSchema = z.object({
  type: z.literal("location"),
  characterId: z.string(),
  record: LocationRecordSchema,
});
export type LocationStreamEvent = z.infer<typeof LocationStreamEventSchema>;

/**
 * `connected` with the observer-scope additions (journal high-water, status
 * seed).
 */
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
  DesiresStreamEventSchema,
  LocationStreamEventSchema,
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
