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
  /**
   * Plain text; for an action, what the sender does (render as done); for a
   * sticker, what it shows, as everyone in the chat reads it (its alt text).
   */
  text: z.string(),
  /**
   * Absent: speech. An action is done where the sender is, in third person. A
   * sticker is a picture from a character's own set, shown without a bubble.
   */
  type: z.enum(["speech", "action", "sticker"]).optional(),
  /** Stickers only: its name in the sender's set and where to load it. */
  sticker: z.object({ name: z.string(), url: z.string() }).optional(),
  timestamp: z.number(),
  /**
   * The stored record's real time, for lining it up with a brain trace. Only
   * history has it.
   */
  createdAt: z.number().optional(),
  /**
   * Each character it reached, and when (sim time) their brain was shown it:
   * read, in a text chat (or a later message there, as opening a chat shows
   * it); observed, face to face. One that hasn't yet has no `readAt`. Humans
   * have no receipts.
   */
  receipts: z
    .array(z.object({ id: z.string(), readAt: z.number().optional() }))
    .optional(),
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

/**
 * GET /kazusa/observe/chats: conversations the player is not in. Read-only, so
 * there is no address to send to. `ended`: nobody is left in it (a huddle that
 * dissolved); `members` are then the people who were.
 */
export const ObservedChatSchema = ChatSchema.omit({ sessionKey: true }).extend({
  ended: z.boolean().optional(),
});
export type ObservedChat = z.infer<typeof ObservedChatSchema>;

export const ObservedChatsResponseSchema = z.object({
  chats: z.array(ObservedChatSchema),
});
export type ObservedChatsResponse = z.infer<typeof ObservedChatsResponseSchema>;

/** POST /kazusa/send */
export const SendPayloadSchema = z
  .object({
    requestId: z.string().trim().min(1),
    text: z.string().min(1),
    /** Absent: speech. Actions are kept only in huddles (face to face). */
    type: z.enum(["speech", "action"]).optional(),
    /**
     * With `members`: say it face to face to people where you are, as `talk`
     * turns to them: you walk over to their conversation, split a side one off
     * your own, or they join yours. Refused when they are in two at once.
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
  /** Typed into a chat, or said aloud face to face. */
  mode: z.enum(["typing", "speaking"]),
  /** A person's own signal lapses unless renewed; a character's is cleared. */
  expiresAt: z.number().optional(),
});
export type TypingStreamEvent = z.infer<typeof TypingStreamEventSchema>;

export const MessageStreamEventSchema = z.object({
  type: z.literal("message"),
  chatId: z.string(),
  message: ChatMessageSchema,
});
export type MessageStreamEvent = z.infer<typeof MessageStreamEventSchema>;

/** A character read these messages (and every earlier one of theirs here). */
export const ReadStreamEventSchema = z.object({
  type: z.literal("read"),
  chatId: z.string(),
  readerId: z.string(),
  /** Sim time. */
  readAt: z.number(),
  messageIds: z.array(z.string()),
});
export type ReadStreamEvent = z.infer<typeof ReadStreamEventSchema>;

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
  ReadStreamEventSchema,
  ConnectedEventSchema,
  ChatsStreamEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

/* ========================================================================== */
/* Read model: world + clock (PROPOSED — GET /kazusa/world, POST /kazusa/clock) */
/* ========================================================================== */

/** A slice of the read model that resolves to live/unavailable on its own. */
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
  "profile",
  "wiki",
  "brain",
  "usage",
  "context",
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

/** Sparse choices for one scope; absent fields inherit their defaults. */
export const ModelOverridesSchema = z.object({
  model: ModelRefSchema.optional(),
  thinking: ThinkingLevelSchema.optional(),
});
export type ModelOverrides = z.infer<typeof ModelOverridesSchema>;

/** GET /kazusa/models. Optional `agentId`; `refresh=1` refreshes the catalog. */
export const ModelsResponseSchema = z.object({
  /** Absent: world defaults. Present: this agent's effective selection. */
  agentId: z.string().optional(),
  /** Only the agent's explicit choices, before world defaults are applied. */
  overrides: ModelOverridesSchema.optional(),
  /**
   * The effective primary: agent choice, then world choice, then `configured`.
   * Kazusa applies it per turn, not through `openclaw.json`.
   */
  current: ModelRefSchema.optional(),
  /**
   * What runs until a model is picked: an agent's own model in `openclaw.json`,
   * else the world's starting model (the first of Kazusa's `models.chat` a
   * provider with a key serves), else the configured primary.
   */
  configured: ModelRefSchema.optional(),
  /**
   * The effective reasoning choice: agent, then world. Absent: OpenClaw's
   * default. A level the model lacks is remapped by OpenClaw to the nearest one
   * it has.
   */
  thinking: ThinkingLevelSchema.optional(),
  models: z.array(ModelOptionSchema),
  providers: z.array(ModelProviderStatusSchema),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

/**
 * Where a provider's key comes from. `profile`: the OpenClaw auth profile
 * Kazusa saves a pasted key in. `env`: an environment variable (the world's
 * `.state/.env`, read at Gateway start). `config`: anything written into
 * `openclaw.json` by hand. `none`: no key Kazusa can see.
 */
export const ProviderKeySourceSchema = z.enum([
  "profile",
  "env",
  "config",
  "none",
]);
export type ProviderKeySource = z.infer<typeof ProviderKeySourceSchema>;

export const ProviderSummarySchema = z.object({
  /** OpenClaw's provider id, as in model refs (`openrouter/...`). */
  id: z.string(),
  label: z.string(),
  /** One line on what it offers. */
  hint: z.string().optional(),
  /** Where to create a key. */
  keysUrl: z.string().url().optional(),
  /** The environment variable it reads when no profile holds a key. */
  keyName: z.string(),
  key: ProviderKeySourceSchema,
});
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;

/** GET /kazusa/providers: every provider this Gateway can use, alphabetical. */
export const ProvidersResponseSchema = z.object({
  providers: z.array(ProviderSummarySchema),
});
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;

/**
 * POST /kazusa/providers/key. Saves `key` as the provider's auth profile, so
 * nothing in `openclaw.json` changes and nothing reloads. Answers with the
 * provider; its models need a catalog refresh.
 */
export const ProviderKeyPayloadSchema = z.object({
  provider: z.string().min(1),
  key: z.string().trim().min(1),
});
export type ProviderKeyPayload = z.infer<typeof ProviderKeyPayloadSchema>;

/** POST /kazusa/providers/remove. Forgets the key Kazusa saved, and only that. */
export const ProviderRemovePayloadSchema = z.object({
  provider: z.string().min(1),
});
export type ProviderRemovePayload = z.infer<typeof ProviderRemovePayloadSchema>;

/**
 * Model providers that take one pasted API key, from OpenClaw's bundled
 * plugins, the official `@openclaw/*-provider` packages this app ships, and
 * OpenRP's own. Settings and the setup guide both list from it. Ids, plugins
 * and variables come from each plugin's manifest (`providerAuthChoices`,
 * `setup.providers[].envVars`); a provider shows only when its plugin is
 * allowed in `openclaw.json`. Alphabetical by label.
 */
export interface ProviderEntry {
  /** OpenClaw's provider id, as in model refs. */
  readonly id: string;
  readonly plugin: string;
  readonly label: string;
  readonly hint?: string;
  readonly keysUrl?: string;
  /** The variable OpenClaw reads first when no auth profile holds a key. */
  readonly keyName: string;
  /** Every variable the plugin reads a key from, `keyName` included. */
  readonly envVars: readonly string[];
}

const entry = (
  id: string,
  label: string,
  rest: Partial<ProviderEntry> & { readonly keyName: string },
): ProviderEntry => ({
  id,
  plugin: id,
  label,
  envVars: [rest.keyName],
  ...rest,
});

export const PROVIDERS: readonly ProviderEntry[] = [
  entry("anthropic", "Anthropic", {
    hint: "Claude models",
    keysUrl: "https://console.anthropic.com/settings/keys",
    keyName: "ANTHROPIC_API_KEY",
  }),
  entry("byteplus", "BytePlus", {
    hint: "ByteDance's models, outside China",
    keyName: "BYTEPLUS_API_KEY",
  }),
  entry("cerebras", "Cerebras", {
    hint: "Very fast open models",
    keysUrl: "https://cloud.cerebras.ai",
    keyName: "CEREBRAS_API_KEY",
  }),
  entry("chutes", "Chutes", {
    hint: "Hosted open models",
    keysUrl: "https://chutes.ai/app/settings/api-keys",
    keyName: "CHUTES_API_KEY",
  }),
  entry("deepinfra", "DeepInfra", {
    hint: "Hosted open models",
    keysUrl: "https://deepinfra.com/dash/api_keys",
    keyName: "DEEPINFRA_API_KEY",
  }),
  entry("deepseek", "DeepSeek", {
    hint: "DeepSeek's own models",
    keysUrl: "https://platform.deepseek.com/api_keys",
    keyName: "DEEPSEEK_API_KEY",
  }),
  entry("fireworks", "Fireworks", {
    hint: "Hosted open models",
    keysUrl: "https://fireworks.ai/account/api-keys",
    keyName: "FIREWORKS_API_KEY",
  }),
  entry("google", "Google Gemini", {
    hint: "Gemini models",
    keysUrl: "https://aistudio.google.com/apikey",
    keyName: "GEMINI_API_KEY",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  }),
  entry("groq", "Groq", {
    hint: "Very fast open models",
    keysUrl: "https://console.groq.com/keys",
    keyName: "GROQ_API_KEY",
  }),
  entry("huggingface", "Hugging Face", {
    hint: "Open models through Inference Providers",
    keysUrl: "https://huggingface.co/settings/tokens",
    keyName: "HF_TOKEN",
    envVars: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
  }),
  entry("mistral", "Mistral AI", {
    hint: "Mistral's own models",
    keysUrl: "https://console.mistral.ai/api-keys",
    keyName: "MISTRAL_API_KEY",
  }),
  entry("moonshot", "Moonshot AI", {
    hint: "Kimi models",
    keysUrl: "https://platform.kimi.ai",
    keyName: "MOONSHOT_API_KEY",
    envVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  }),
  entry("novita", "Novita AI", {
    hint: "Hosted open models",
    keysUrl: "https://novita.ai/settings/key-management",
    keyName: "NOVITA_API_KEY",
  }),
  entry("nvidia", "NVIDIA", {
    hint: "Open models on NVIDIA's servers",
    keysUrl: "https://build.nvidia.com/settings/api-keys",
    keyName: "NVIDIA_API_KEY",
  }),
  entry("ollama-cloud", "Ollama Cloud", {
    plugin: "ollama",
    hint: "Open models on Ollama's servers",
    keysUrl: "https://ollama.com/settings/keys",
    keyName: "OLLAMA_API_KEY",
  }),
  entry("openai", "OpenAI", {
    hint: "GPT models",
    keysUrl: "https://platform.openai.com/api-keys",
    keyName: "OPENAI_API_KEY",
  }),
  entry("opencode-go", "OpenCode", {
    hint: "OpenCode Zen and Go models",
    keyName: "OPENCODE_API_KEY",
    envVars: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
  }),
  entry("openrouter", "OpenRouter", {
    hint: "Hundreds of models behind one key",
    keysUrl: "https://openrouter.ai/keys",
    keyName: "OPENROUTER_API_KEY",
  }),
  entry("openrp", "OpenRP", {
    hint: "Popular models, paid with Diamonds",
    keysUrl: "https://openrp.ai/settings/api-keys",
    keyName: "OPENRP_API_KEY",
  }),
  entry("qwen", "Qwen Cloud", {
    hint: "Alibaba's Qwen models",
    keysUrl: "https://home.qwencloud.com/api-keys",
    keyName: "QWEN_API_KEY",
    envVars: ["QWEN_API_KEY", "MODELSTUDIO_API_KEY", "DASHSCOPE_API_KEY"],
  }),
  entry("synthetic", "Synthetic", {
    hint: "Hosted open models",
    keyName: "SYNTHETIC_API_KEY",
  }),
  entry("typesafe", "TypeSafe", {
    plugin: "kazusa",
    hint: "Jev decisions, billed by TypeSafe",
    keyName: "TYPESAFE_API_KEY",
    // Only Kazusa's Jev calls it, and it reads the auth profile alone.
    envVars: [],
  }),
  entry("together", "Together AI", {
    hint: "Hosted open models",
    keysUrl: "https://api.together.ai/settings/api-keys",
    keyName: "TOGETHER_API_KEY",
  }),
  entry("venice", "Venice AI", {
    hint: "Private and uncensored models",
    keysUrl: "https://venice.ai/settings/api",
    keyName: "VENICE_API_KEY",
  }),
  entry("volcengine", "Volcano Engine", {
    hint: "ByteDance's models, in China",
    keyName: "VOLCANO_ENGINE_API_KEY",
  }),
  entry("xai", "xAI", {
    hint: "Grok models",
    keysUrl: "https://console.x.ai",
    keyName: "XAI_API_KEY",
  }),
  entry("zai", "Z.AI", {
    hint: "GLM models",
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    keyName: "ZAI_API_KEY",
    envVars: ["ZAI_API_KEY", "Z_AI_API_KEY"],
  }),
];

/**
 * One choice for a model role other than chat: the same model through two
 * providers is two choices, picked by whose key pays for it.
 */
export const RoleModelOptionSchema = z.object({
  /** `provider/model`. */
  ref: z.string(),
  provider: z.string(),
  name: z.string(),
  available: z.boolean(),
  unavailableReason: z.enum(["missing-auth"]).optional(),
});
export type RoleModelOption = z.infer<typeof RoleModelOptionSchema>;

/**
 * GET /kazusa/models/decision: who runs Jev, which judges what reaches a
 * character. Kept in Kazusa's selection, not `openclaw.json`.
 */
export const DecisionModelsResponseSchema = z.object({
  current: z.string(),
  options: z.array(RoleModelOptionSchema),
});
export type DecisionModelsResponse = z.infer<
  typeof DecisionModelsResponseSchema
>;

/** POST /kazusa/models/decision/select. */
export const DecisionModelSelectPayloadSchema = z.object({
  ref: z.string().min(1),
});
export type DecisionModelSelectPayload = z.infer<
  typeof DecisionModelSelectPayloadSchema
>;

export const EmbeddingModelOptionSchema = RoleModelOptionSchema.extend({
  /** Choices with the same value make the same vectors, so they share them. */
  vectors: z.string(),
});
export type EmbeddingModelOption = z.infer<typeof EmbeddingModelOptionSchema>;

/** GET /kazusa/models/embedding: the memory search model and its progress. */
export const EmbeddingModelsResponseSchema = z.object({
  current: z.string(),
  /**
   * What runs unpicked: a hand-configured `memory.embedding` endpoint, else the
   * first of Kazusa's `models.embedding` a provider with a key serves.
   */
  configured: z.string(),
  options: z.array(EmbeddingModelOptionSchema),
  /** Passages of the loaded wikis with a vector from the current model. */
  progress: z.object({
    embedded: z.number().int(),
    total: z.number().int(),
  }),
});
export type EmbeddingModelsResponse = z.infer<
  typeof EmbeddingModelsResponseSchema
>;

/** POST /kazusa/models/embedding/select. `null` goes back to `configured`. */
export const EmbeddingModelSelectPayloadSchema = z.object({
  ref: z.string().min(1).nullable(),
});
export type EmbeddingModelSelectPayload = z.infer<
  typeof EmbeddingModelSelectPayloadSchema
>;

/** GET /kazusa/profile: who the player is. Only `about` can be edited. */
export const ProfileResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Their World Wiki page, under its title. */
  about: z.string(),
  /** That page, relative to the world's `shared` folder. */
  wikiPage: z.string(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

/** POST /kazusa/profile/save. Answers with the new profile. */
export const ProfileSavePayloadSchema = z.object({
  about: z.string().max(20_000),
});
export type ProfileSavePayload = z.infer<typeof ProfileSavePayloadSchema>;

/** POST /kazusa/model. Omit `agentId` for world defaults; `null` inherits. */
export const ModelSelectPayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
  ref: ModelRefSchema.nullable(),
});
export type ModelSelectPayload = z.infer<typeof ModelSelectPayloadSchema>;

export const ModelSelectResponseSchema = z.object({
  agentId: z.string().optional(),
  current: ModelRefSchema.optional(),
});
export type ModelSelectResponse = z.infer<typeof ModelSelectResponseSchema>;

/** POST /kazusa/thinking. Omit `agentId` for world defaults; `null` inherits. */
export const ThinkingSelectPayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
  level: ThinkingLevelSchema.nullable(),
});
export type ThinkingSelectPayload = z.infer<typeof ThinkingSelectPayloadSchema>;

export const ThinkingSelectResponseSchema = z.object({
  agentId: z.string().optional(),
  thinking: ThinkingLevelSchema.optional(),
});
export type ThinkingSelectResponse = z.infer<
  typeof ThinkingSelectResponseSchema
>;

/* ========================================================================== */
/* Read model: context (GET /kazusa/context/settings)                         */
/* ========================================================================== */

/**
 * How much a character remembers and sends to its model each turn. The world
 * sets these; a character may override any of them. Kept in Kazusa's store, so
 * a change reloads nothing.
 */
export const ContextSettingsSchema = z.object({
  /** How far back records reach, in sim hours. */
  shortTermHours: z
    .number()
    .min(24)
    .max(24 * 30),
  /** Records' share of a turn; `"unlimited"` takes what the maximum leaves. */
  ledgerMaxTokens: z.union([z.number().int().min(0), z.literal("unlimited")]),
  /**
   * The most one brain call sends, everything included; `"unlimited"` is the
   * model's whole window.
   */
  maxContextTokens: z.union([
    z.number().int().min(16_000),
    z.literal("unlimited"),
  ]),
  /** The records' start moves in steps of this many sim hours. */
  ledgerGridHours: z.number().positive().max(24),
  /** Share of their budget the records are cut back to when outgrown. */
  ledgerTrimTo: z.number().gt(0).max(1),
  /** `On your mind`: recollections each turn brings up, in tokens. */
  onYourMindTokens: z.number().int().min(0).max(32_000),
  /** `People you know`: how many. */
  peopleLimit: z.number().int().min(0).max(200),
  /** `Where you are`: places around them and places they know, each. */
  placesLimit: z.number().int().min(0).max(50),
  /** Their past tool calls, in tokens. */
  toolHistoryTokens: z.number().int().min(0).max(32_000),
});
export type ContextSettings = z.infer<typeof ContextSettingsSchema>;

/** One scope's own choices; absent fields inherit. */
export const ContextOverridesSchema = ContextSettingsSchema.partial();
export type ContextOverrides = z.infer<typeof ContextOverridesSchema>;

export const ContextSettingsResponseSchema = z.object({
  agentId: z.string().optional(),
  /** What this scope inherits: the world's for a character, built-in for it. */
  inherited: ContextSettingsSchema,
  overrides: ContextOverridesSchema,
  /** What turns use: `inherited` with `overrides` on top. */
  effective: ContextSettingsSchema,
  /** The model's own window, when a character's session knows it. */
  modelContextTokens: z.number().int().positive().optional(),
});
export type ContextSettingsResponse = z.infer<
  typeof ContextSettingsResponseSchema
>;

/** Replaces one scope's overrides. Omit `agentId` for the world. */
export const ContextSettingsSavePayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
  overrides: ContextOverridesSchema,
});
export type ContextSettingsSavePayload = z.infer<
  typeof ContextSettingsSavePayloadSchema
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

/** Operator stop: target the character's current brain run. */
export const BrainAbortPayloadSchema = z.strictObject({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
});
export type BrainAbortPayload = z.infer<typeof BrainAbortPayloadSchema>;
export const BrainAbortResponseSchema = z.object({
  aborted: z.boolean(),
  drained: z.boolean(),
});
export type BrainAbortResponse = z.infer<typeof BrainAbortResponseSchema>;

/** What one model call reported. Absent counters were not reported. */
export const BrainUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number().optional(),
  total: z.number(),
  cost: z.number().optional(),
});
export type BrainUsage = z.infer<typeof BrainUsageSchema>;

export const BrainStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thinking"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    id: z.string(),
    name: z.string(),
    /** Pretty-printed arguments. */
    input: z.string(),
    /** Absent when the transcript holds no result; the call may still have run. */
    result: z.string().optional(),
    isError: z.boolean().optional(),
  }),
]);
export type BrainStep = z.infer<typeof BrainStepSchema>;

/** One LLM call. Times here are real time: this is a debug view of the host. */
export const BrainCallSchema = z.object({
  id: z.string(),
  at: z.number().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
  error: z.string().optional(),
  usage: BrainUsageSchema.optional(),
  steps: z.array(BrainStepSchema),
});
export type BrainCall = z.infer<typeof BrainCallSchema>;

/** One run of the brain: what woke it, then every LLM call of the chain. */
export const BrainTurnSchema = z.object({
  id: z.string(),
  at: z.number().optional(),
  prompts: z.array(z.string()),
  calls: z.array(BrainCallSchema),
  usage: BrainUsageSchema.optional(),
  /** Why the run failed, when no LLM call recorded it. */
  error: z.string().optional(),
});
export type BrainTurn = z.infer<typeof BrainTurnSchema>;

/** The brain session's latest turns, newest first. */
export const BrainTraceResponseSchema = z.object({
  turns: z.array(BrainTurnSchema),
  total: z.number(),
});
export type BrainTraceResponse = z.infer<typeof BrainTraceResponseSchema>;

const UsageTotalsSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  /** Calls with no known price; `totalCost` leaves them out. */
  missingCostEntries: z.number(),
});
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

/** OpenClaw's own session-derived report (`sessions.usage`), for all agents. */
export const UsageResponseSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  totals: UsageTotalsSchema,
  sessionCount: z.number(),
  messages: z.object({
    total: z.number(),
    toolCalls: z.number(),
    errors: z.number(),
  }),
  byAgent: z.array(
    z.object({ agentId: z.string(), totals: UsageTotalsSchema }),
  ),
  byModel: z.array(
    z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
      count: z.number(),
      totals: UsageTotalsSchema,
    }),
  ),
  daily: z.array(
    z.object({ date: z.string(), tokens: z.number(), cost: z.number() }),
  ),
  /** True while OpenClaw is still reading history, so the totals are partial. */
  partial: z.boolean(),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

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
  /** Why the latest run failed, until one gets through. `at` is real time. */
  failure: z.object({ error: z.string(), at: z.number() }).optional(),
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
  /**
   * Where it's drawn on the map; absent means automatic. Coordinates are a
   * fraction of the map, and each plane is its own map. Only a picture: travel
   * times come from `connections`, never from here.
   */
  map: z
    .object({
      plane: z.string().optional(),
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  bodyMarkdown: z.string(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Places in tree order: each area, then its places by name. */
export const PlacesResponseSchema = z.object({ places: z.array(PlaceSchema) });
export type PlacesResponse = z.infer<typeof PlacesResponseSchema>;

/**
 * POST /kazusa/places/positions: where places are drawn, written to their
 * pages.
 */
export const PlacePositionsSchema = z.object({
  positions: z.record(
    z.string(),
    z.object({ x: z.number().finite(), y: z.number().finite() }),
  ),
});
export type PlacePositions = z.infer<typeof PlacePositionsSchema>;
export const PlacePositionsResponseSchema = z.object({ written: z.number() });
export type PlacePositionsResponse = z.infer<
  typeof PlacePositionsResponseSchema
>;

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
  /** Estimated tokens by part; the host's own prompt is on top of these. */
  breakdown: z
    .object({
      skills: z.number(),
      situation: z.number(),
      history: z.number(),
      records: z.number(),
      /** Past turns' tool calls and outcomes. */
      tools: z.number().default(0),
    })
    .optional(),
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
  /** Orders events: sim time first, stable for the same event live and reread. */
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
    /** The new end, estimated from the time of the event. */
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
    /**
     * A conversation in person (its address) they stopped following: its lines
     * in this batch went unheard, and they left it.
     */
    tunedOut: z.string().optional(),
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

export const MemoryConsolidatedEventSchema = z.object({
  ...JournalBase,
  kind: z.literal("memory.consolidated"),
  payload: z.object({
    /** Empty when `interrupted`: nothing was applied. */
    runId: z.string(),
    from: z.number(),
    to: z.number(),
    pages: z.array(z.string()),
    newPages: z.array(z.string()),
    notes: z.number(),
    interrupted: z.boolean(),
    dream: z.string().optional(),
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
  MemoryConsolidatedEventSchema,
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

/** The world's map changed on disk: refetch `GET /kazusa/places`. */
export const PlacesStreamEventSchema = z.object({ type: z.literal("places") });
export type PlacesStreamEvent = z.infer<typeof PlacesStreamEventSchema>;

/**
 * What happens in chats the player isn't in, wrapped so it is never applied as
 * the player's own: a message, someone composing, or a change to the chat
 * list.
 */
export const ObservedStreamEventSchema = z.object({
  type: z.literal("observed"),
  event: z.discriminatedUnion("type", [
    MessageStreamEventSchema,
    TypingStreamEventSchema,
    ChatsStreamEventSchema,
  ]),
});
export type ObservedStreamEvent = z.infer<typeof ObservedStreamEventSchema>;

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
  ReadStreamEventSchema,
  ObserverConnectedEventSchema,
  ChatsStreamEventSchema,
  StatusStreamEventSchema,
  JournalStreamEventSchema,
  ClockStreamEventSchema,
  DesiresStreamEventSchema,
  LocationStreamEventSchema,
  PlacesStreamEventSchema,
  ObservedStreamEventSchema,
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

/* -------------------------------------------------------------------------- */
/* Read model: wiki (GET /kazusa/wiki, /wiki/page, /wiki/lint, /memory/runs)  */
/* -------------------------------------------------------------------------- */

export const WikiKindSchema = z.enum(["place", "person", "concept", "day"]);
export type WikiKind = z.infer<typeof WikiKindSchema>;

export const WikiListItemSchema = z.object({
  id: z.string(),
  kind: WikiKindSchema,
  name: z.string(),
  summary: z.string(),
});
export type WikiListItem = z.infer<typeof WikiListItemSchema>;

/** One wiki's pages: the world's without `agent`, a character's with it. */
export const WikiListResponseSchema = z.object({
  pages: z.array(WikiListItemSchema),
});
export type WikiListResponse = z.infer<typeof WikiListResponseSchema>;

export const WikiPageSchema = WikiListItemSchema.extend({
  aliases: z.array(z.string()),
  /** The lead, verbatim Markdown. */
  lead: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      text: z.string(),
      knownBy: z.array(z.string()),
    }),
  ),
  notes: z.array(
    z.object({
      date: z.string(),
      source: z.string(),
      certainty: z.string(),
      text: z.string(),
    }),
  ),
  history: z.array(
    z.object({ date: z.string(), news: z.boolean(), text: z.string() }),
  ),
  openThreads: z.array(z.string()),
  theyThinkOfMe: z.string().optional(),
  relation: z.string().optional(),
  community: z.string().optional(),
  renown: z.string().optional(),
  knownBy: z.array(z.string()),
  seen: z.string().optional(),
});
export type WikiPage = z.infer<typeof WikiPageSchema>;

export const KnowledgeSchema = z.object({
  depth: z.enum(["none", "heard of", "familiar", "intimate"]),
  why: z.string(),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

/** One thing: canon, what `agent` makes of it, and how well they know it. */
export const WikiPageResponseSchema = z.object({
  world: WikiPageSchema.optional(),
  personal: WikiPageSchema.optional(),
  knowledge: KnowledgeSchema.optional(),
});
export type WikiPageResponse = z.infer<typeof WikiPageResponseSchema>;

/**
 * GET /kazusa/wiki/source?id=&agent=: one page's Markdown as written. A page
 * not written yet has `exists: false`, empty `text` and the path it would get.
 */
export const WikiSourceResponseSchema = z.object({
  id: z.string(),
  /** Relative to the wiki's root, e.g. `entities/places/plaza.md`. */
  path: z.string(),
  text: z.string(),
  exists: z.boolean(),
  /** What the save checks, so a write made meanwhile isn't lost. */
  hash: z.string().nullable(),
});
export type WikiSourceResponse = z.infer<typeof WikiSourceResponseSchema>;

/**
 * POST /kazusa/wiki/save. Answers with the new source, or 409 with `{ error,
 * current }` when the page changed since `base` was read. `base: null` means
 * the page must not exist yet; omitting it overwrites whatever is there. `kind`
 * places a new page; an existing one stays where it is.
 */
export const WikiSavePayloadSchema = z.object({
  id: z
    .string()
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u, "Use letters, digits, _ or -."),
  agent: z.string().min(1).optional(),
  kind: WikiKindSchema.optional(),
  text: z.string().max(200_000),
  base: z.string().nullable().optional(),
});
export type WikiSavePayload = z.infer<typeof WikiSavePayloadSchema>;

export const WikiLintResponseSchema = z.object({
  findings: z.array(
    z.object({
      level: z.enum(["error", "warning"]),
      page: z.string(),
      message: z.string(),
    }),
  ),
});
export type WikiLintResponse = z.infer<typeof WikiLintResponseSchema>;

/** Sleep passes, newest first, with each file before and after. */
export const MemoryRunsResponseSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      at: z.number(),
      files: z.array(
        z.object({
          path: z.string(),
          before: z.string().nullable(),
          after: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type MemoryRunsResponse = z.infer<typeof MemoryRunsResponseSchema>;
