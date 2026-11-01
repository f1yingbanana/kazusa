import { homedir } from "node:os";
import path from "node:path";
import type {
  MemoryRunsResponse,
  WikiLintResponse,
  WikiListItem,
  WikiListResponse,
  WikiPage,
  WikiPageResponse,
} from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { currentConfig } from "../current-config.ts";
import { sharedDir } from "../shared-dir.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { inBackground } from "../background.ts";
import { resolveStateDir } from "../context-engine/skill-loader.ts";
import type { Clock } from "../clock/clock.ts";
import { createSkillLoader } from "../context-engine/skill-loader.ts";
import { appendLedgerEntry } from "../ledger.ts";
import { withJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";
import { createSleep, type SleepPass, type SleepState } from "./sleep.ts";
import {
  embedPending,
  embedQuery,
  openAiEmbedder,
  type Embedder,
} from "./embeddings.ts";
import { MemoryIndex, WORLD_SCOPE } from "./index.ts";
import type { Anchors } from "./knowledge.ts";
import { lintMap } from "../location/world.ts";
import { auditWorld, workspacesBeside, type WorldAudit } from "./audit.ts";
import { lintPersonal, lintWorld, type LintFinding } from "./lint.ts";
import type { Certainty, HistoryLine, Page } from "./page.ts";
import { renderEntity, renderOnYourMind, renderRoster } from "./render.ts";
import {
  mentionsIn,
  retrieve,
  spokenText,
  type Entity,
  type RetrievalRequest,
} from "./retrieve.ts";
import {
  applyOperation,
  newPage,
  withField,
  withNote,
  withPlan,
} from "./writes.ts";

export const MEMORY_CONFIG = z.strictObject({
  wikiDir: z.string().min(1).optional(),
  maxTokens: z.number().int().min(0).max(32_000).default(800),
  rosterLimit: z.number().int().min(0).max(200).default(20),
  /** Which card fields place a character in this world, and how deeply. */
  anchors: z
    .record(z.string(), z.enum(["heard of", "familiar", "intimate"]))
    .default({ club: "intimate", school: "familiar" }),
  /**
   * Offline consolidation. Off until a world turns it on: it sends a day's
   * records and the character's pages to the model.
   */
  sleep: z
    .strictObject({
      enabled: z.boolean().default(false),
      categories: z.array(z.string()).default(["sleeping"]),
      minMinutes: z.number().int().min(0).default(180),
      notesPerPage: z.number().int().min(1).default(30),
    })
    .default({
      enabled: false,
      categories: ["sleeping"],
      minMinutes: 180,
      notesPerPage: 30,
    }),
  /** Secrets stay in the environment; absent means keywords only. */
  embedding: z
    .strictObject({
      baseUrl: z.string().default("https://openrouter.ai/api/v1"),
      apiKeyEnv: z.string().default("OPENROUTER_API_KEY"),
      model: z.string().default("openai/text-embedding-3-small"),
    })
    .prefault({}),
});

export interface MemoryPrefetch {
  /** `On your mind`, empty when nothing came up. */
  readonly onYourMind: string;
  /** `People you know`. */
  readonly roster: string;
  readonly ids: readonly string[];
}

export interface MemoryService {
  readonly prefetch: (
    request: RetrievalRequest,
    options?: { readonly maxTokens?: number },
  ) => Promise<MemoryPrefetch>;
  /** World events at this place since they last saw it, in the world's words. */
  readonly placeChanges: (
    agentId: string,
    placeId: string,
    now: number,
  ) => readonly string[];
  /** They took the place in: stamps their card and notes what changed. */
  readonly visited: (agentId: string, placeId: string, now: number) => void;
  /** Their own place cards this text brings up, keywords only. */
  readonly places: (agentId: string, text: string, now: number) => string[];
  /** Whole entities, one string each, for the decision context. */
  readonly recollections: (
    request: RetrievalRequest,
    limit: number,
  ) => readonly string[];
  readonly entities: (request: RetrievalRequest) => readonly Entity[];
  readonly lint: (agentId?: string) => readonly LintFinding[];
  readonly audit: () => WorldAudit;
  readonly explain: (agentId: string, pageId?: string) => unknown;
  readonly sleep: ReturnType<typeof createSleep>;
}

/** A slow provider took 100 s on an ordinary turn; a night is a larger one. */
const SLEEP_TIMEOUT_MS = 240_000;
const INDEX_CELL = Symbol.for("kazusa.memory");
const PASSES_CELL = Symbol.for("kazusa.memory.sleep");
type Cells = Map<string, MemoryIndex>;

/** One index per world per process: every registration shares it. */
function sharedIndex(
  api: OpenClawPluginApi,
  worldDir: string,
  model: string,
  anchors: Anchors,
): MemoryIndex {
  const holder = globalThis as unknown as Record<symbol, Cells | undefined>;
  const cells: Cells = holder[INDEX_CELL] ?? new Map<string, MemoryIndex>();
  holder[INDEX_CELL] = cells;
  let index = cells.get(worldDir);
  if (!index) {
    index = new MemoryIndex({
      worldDir,
      model,
      anchors,
      vectorsPath: path.join(
        resolveStateDir(process.env, homedir()),
        "kazusa",
        "memory-vectors.sqlite",
      ),
      workspaceDir: (agentId) =>
        api.runtime.agent.resolveAgentWorkspaceDir(currentConfig(api), agentId),
    });
    cells.set(worldDir, index);
  }
  return index;
}

/** A rough estimate is enough here: entities are dropped whole, never cut. */
const estimate = (text: string): number => Math.ceil(text.length / 4);

const CERTAINTIES = ["sure", "think so", "suspect", "doubt it"] as const;
const SOURCE = /^(seen it|read it|my guess|(told by|overheard) .+)$/;
const SLUG = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
const DIRECTORY: Readonly<Record<Page["kind"], string>> = {
  person: path.join("entities", "characters"),
  place: path.join("entities", "places"),
  concept: "concepts",
  day: "days",
};

export function registerMemory(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "time">;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly feelings?: (agentId: string, at: number) => Promise<string>;
    /** The model a character actually runs on, which config doesn't know. */
    readonly modelOf?: (agentId: string) => Promise<string | undefined>;
    /** The context engine registers later; it owns reading the ledgers. */
    readonly experiences: (
      agentId: string,
      since: number,
      now: number,
    ) => Promise<{
      readonly text: string;
      readonly speakers: readonly string[];
      readonly through: number;
    }>;
  },
): MemoryService {
  const config = MEMORY_CONFIG.parse(
    (api.pluginConfig as { memory?: unknown } | undefined)?.memory ?? {},
  );
  const index = sharedIndex(
    api,
    config.wikiDir ?? sharedDir("wiki"),
    config.embedding.model,
    config.anchors,
  );
  const nameOf = (id: string): string | undefined =>
    index.world().pages.get(id)?.name;
  const warn = (message: string): void => {
    api.logger.warn(message);
  };

  const apiKey = process.env[config.embedding.apiKeyEnv];
  const embedder: Embedder | undefined = apiKey
    ? openAiEmbedder({
        baseUrl: config.embedding.baseUrl,
        apiKey,
        model: config.embedding.model,
      })
    : undefined;
  /** One background embed at a time; a turn never waits for it. */
  let embedding = false;
  const embedInBackground = (agentId: string): void => {
    if (!embedder || embedding) return;
    embedding = true;
    void embedPending(index, embedder, agentId)
      .catch((error: unknown) => {
        warn(`Memory: embedding failed: ${String(error)}`);
      })
      .finally(() => {
        embedding = false;
      });
  };
  const withVector = async (
    request: RetrievalRequest,
  ): Promise<RetrievalRequest> => {
    const queryVector =
      embedder &&
      (await embedQuery(embedder, spokenText(request.stimulus), warn));
    return queryVector ? { ...request, queryVector } : request;
  };

  const changesSince = (
    agentId: string,
    placeId: string,
    now: number,
  ): readonly HistoryLine[] => {
    const history = index.world().pages.get(placeId)?.history ?? [];
    const seen = index.personal(agentId).get(placeId)?.seen;
    const today = new Date(now).toISOString().slice(0, 10);
    return history.filter(
      (line) => line.date <= today && (!seen || line.date > seen),
    );
  };

  const workspaceOf = (agentId: string): string =>
    api.runtime.agent.resolveAgentWorkspaceDir(currentConfig(api), agentId);
  const skills = createSkillLoader({
    config: currentConfig(api),
    pluginRootDir: api.rootDir,
  });
  const holder = globalThis as unknown as Record<
    symbol,
    Map<string, SleepPass> | undefined
  >;
  const passes = holder[PASSES_CELL] ?? new Map<string, SleepPass>();
  holder[PASSES_CELL] = passes;
  const sleep = createSleep(
    {
      index,
      enabled: config.sleep.enabled,
      categories: config.sleep.categories,
      minMinutes: config.sleep.minMinutes,
      notesPerPage: config.sleep.notesPerPage,
      now: () => deps.clock.time(),
      workspaceOf,
      store: api.runtime.state.openKeyedStore<SleepState>({
        namespace: "memory",
        retention: "retained",
      }),
      // Detached: inside a tool or request this inherits the caller's scopes
      // and is cancelled when the caller ends, and a night outlives a tool call.
      complete: ({ agentId, message, instructions, signal }) =>
        new Promise<string>((resolve, reject) => {
          inBackground(
            api,
            async () => {
              const model = await deps.modelOf?.(agentId);
              const { text } = await api.runtime.subagent.complete({
                agentId,
                message,
                ...(model ? { model } : {}),
                extraSystemPrompt: instructions,
                timeoutMs: SLEEP_TIMEOUT_MS,
                signal,
              });
              resolve(text);
            },
            reject,
          );
        }),
      instructions: (agentId) =>
        skills.loadSkill("sleep-consolidation", {
          agentId,
          workspaceDir: workspaceOf(agentId),
        }),
      experiences: deps.experiences,
      ...(deps.feelings ? { feelings: deps.feelings } : {}),
      nameOf,
      record: async (agentId, event, text) => {
        const simTime = deps.clock.time();
        const payload = {
          ...event,
          pages: [...event.pages],
          newPages: [...event.newPages],
        };
        await appendLedgerEntry(api, {
          agentId,
          stream: "tasks",
          text,
          timestamp: simTime,
          metadata: { kind: "memory.consolidated", payload },
        });
        deps.broadcaster?.broadcast({
          type: "journal",
          event: withJournalSeq({
            simTime,
            actors: [agentId],
            kind: "memory.consolidated",
            payload,
          }),
        });
      },
      warn,
    },
    passes,
  );

  const service: MemoryService = {
    sleep,
    prefetch: async (request, options) => {
      const entities = retrieve(index, await withVector(request));
      embedInBackground(request.agentId);
      const { text, ids } = renderOnYourMind(entities, {
        maxTokens: options?.maxTokens ?? config.maxTokens,
        estimate,
        nameOf,
      });
      return {
        onYourMind: text,
        ids,
        roster: renderRoster(
          index.personal(request.agentId).values(),
          config.rosterLimit,
          nameOf,
        ),
      };
    },
    placeChanges: (agentId, placeId, now) =>
      changesSince(agentId, placeId, now).map((line) => line.text),
    visited: (agentId, placeId, now) => {
      const workspace = api.runtime.agent.resolveAgentWorkspaceDir(
        currentConfig(api),
        agentId,
      );
      const changes = changesSince(agentId, placeId, now);
      const date = new Date(now).toISOString().slice(0, 10);
      applyOperation(
        path.join(workspace, "wiki", DIRECTORY.place, `${placeId}.md`),
        (raw) => {
          let next = withField(
            raw ?? newPage(nameOf(placeId) ?? placeId, "been there"),
            "seen",
            date,
          );
          for (const line of changes) {
            next = withNote(next, {
              date,
              source: "seen it",
              certainty: "sure",
              text: line.text,
            });
          }
          return next;
        },
      );
    },
    places: (agentId, text, now) =>
      retrieve(index, { agentId, stimulus: text, now })
        .filter(
          (entity) =>
            entity.personal?.kind === "place" &&
            entity.signals.some((s) => s === "mention" || s === "keyword"),
        )
        .map((entity) => entity.id),
    recollections: (request, limit) =>
      retrieve(index, request)
        .filter((entity) => entity.signals.some((s) => s !== "salience"))
        .slice(0, limit)
        .map((entity) => renderEntity(entity, nameOf)),
    entities: (request) => retrieve(index, request),
    audit: () => {
      const config = currentConfig(api);
      const systemAgent = config.agents?.defaults?.systemAgent?.agentId;
      // Registering comes last, and applies only once its run has ended. A cast
      // still on disk has to count, or the audit passes with nobody to check.
      const onDisk = systemAgent
        ? workspacesBeside(workspaceOf(systemAgent))
        : [];
      return auditWorld(
        index.world(),
        [...new Set([...Object.keys(config.agents?.entries ?? {}), ...onDisk])],
        (agentId) => index.personal(agentId),
        systemAgent,
      );
    },
    lint: (agentId) => {
      const world = index.world();
      return agentId
        ? lintPersonal(agentId, index.personal(agentId).values(), world)
        : [
            ...lintWorld(world),
            ...lintMap(config.wikiDir ?? sharedDir("wiki")),
          ];
    },
    explain: (agentId, pageId) => {
      const world = index.world();
      const personal = index.personal(agentId);
      if (pageId) return world.depth(agentId, pageId, personal.has(pageId));
      const footprint = world.footprint(agentId, new Set(personal.keys()));
      return {
        counts: Object.fromEntries(
          Object.entries(footprint).map(([depth, ids]) => [depth, ids.length]),
        ),
        footprint,
        personalPages: personal.size,
      };
    },
  };

  const toolAgent = (context: { agentId?: string }): string => {
    if (!context.agentId) throw new Error("No character is calling this.");
    return context.agentId;
  };
  const simDate = (): string =>
    new Date(deps.clock.time()).toISOString().slice(0, 10);
  const plain = (text: string) => ({
    content: [{ type: "text" as const, text }],
    details: {},
  });

  api.registerTool((context) => ({
    name: "recall",
    catalogMode: "direct-only",
    label: "Recall",
    description:
      "Try to remember something on the tip of your tongue: searches what you remember and what you would know.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you are trying to remember, in your own words.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const agentId = toolAgent(context);
      const { query } = z.object({ query: z.string().min(1) }).parse(input);
      const found = retrieve(
        index,
        await withVector({ agentId, stimulus: query, now: deps.clock.time() }),
      )
        .filter((entity) =>
          entity.signals.some(
            (s) => s === "mention" || s === "keyword" || s === "semantic",
          ),
        )
        .slice(0, 5);
      embedInBackground(agentId);
      if (!found.length) return plain("Nothing comes to mind.");
      return plain(
        found
          .map(
            (entity) =>
              `${entity.personal ? "You remember" : "Everyone knows"}: ${renderEntity(entity, nameOf)}`,
          )
          .join("\n"),
      );
    },
  }));

  api.registerTool((context) => ({
    name: "look_up",
    catalogMode: "direct-only",
    label: "Look Up",
    description:
      "Check a public source, such as a school portal, for something you don't know. Only finds what is publicly known.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What to look up." },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const agentId = toolAgent(context);
      const { topic } = z.object({ topic: z.string().min(1) }).parse(input);
      const world = index.world();
      const isPublic = (page: Page | undefined): page is Page =>
        Boolean(page) &&
        page!.kind !== "day" &&
        !page!.knownBy.length &&
        (page!.renown === "known" ||
          page!.renown === "famous" ||
          (page!.renown === undefined && page!.kind === "concept"));
      const ids = [
        ...new Set([
          ...mentionsIn(topic, world.pages.values()),
          ...index
            .search(agentId, topic)
            .filter((hit) => hit.scope === WORLD_SCOPE && hit.layer !== "L2")
            .map((hit) => hit.pageId),
        ]),
      ]
        .filter((id) => isPublic(world.pages.get(id)))
        .slice(0, 3);
      const text = ids.length
        ? ids
            .map((id) => {
              const page = world.pages.get(id)!;
              return `${page.name} \`${id}\`: ${(page.lead || page.summary).replace(/\s+/g, " ")}`;
            })
            .join("\n")
        : "Nothing public turns up.";
      // Into their own record, so what they read can stay with them.
      await appendLedgerEntry(api, {
        agentId,
        stream: "tasks",
        text: `Looked up "${topic}".\n${text}`,
        timestamp: deps.clock.time(),
      });
      return plain(text);
    },
  }));

  api.registerTool((context) => ({
    name: "remember",
    catalogMode: "direct-only",
    label: "Remember",
    description:
      "Note a plan or promise someone made with you, someone new you met or heard of, or something that changes how you see someone. Call it before replying. Ordinary chat needs no note.",
    parameters: {
      type: "object",
      properties: {
        about: {
          type: "string",
          description:
            "Who or what it is about, by name or id; `me` for your own plans and promises.",
        },
        note: { type: "string", description: "What to remember." },
        source: {
          type: "string",
          description:
            "How you know: `seen it`, `told by <id>`, `overheard <id>`, `read it` or `my guess`. Defaults to `seen it`.",
        },
        certainty: {
          type: "string",
          enum: [...CERTAINTIES],
          description: "How sure you are. Defaults to `sure`.",
        },
        on: {
          type: "string",
          description:
            "With `about: me`: the day a plan happens, YYYY-MM-DD. Defaults to today.",
        },
      },
      required: ["about", "note"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const agentId = toolAgent(context);
      const args = z
        .object({
          about: z.string().min(1),
          note: z.string().min(1),
          source: z.string().default("seen it"),
          certainty: z.enum(CERTAINTIES).default("sure"),
          on: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .parse(input);
      const workspace = api.runtime.agent.resolveAgentWorkspaceDir(
        currentConfig(api),
        agentId,
      );
      if (["me", "myself"].includes(args.about.trim().toLowerCase())) {
        applyOperation(path.join(workspace, "MEMORY.md"), (raw) =>
          withPlan(raw ?? "", args.on ?? simDate(), args.note),
        );
        return plain("Noted in your plans.");
      }
      if (!SOURCE.test(args.source))
        throw new Error(
          "source must be `seen it`, `told by <id>`, `overheard <id>`, `read it` or `my guess`.",
        );
      const world = index.world();
      const person = args.source.match(/^(?:told by|overheard) (.+)$/)?.[1];
      const teller = person && world.resolve(person);
      if (person && !teller)
        throw new Error(`You don't know anyone called ${person}.`);
      const source = teller ? args.source.replace(person, teller) : args.source;
      const personal = index.personal(agentId);
      const id =
        mentionsIn(args.about, personal.values())[0] ??
        world.resolve(args.about) ??
        mentionsIn(args.about, world.pages.values())[0] ??
        SLUG(args.about);
      if (!id) throw new Error("about needs a name.");
      const existing = personal.get(id);
      const kind = existing?.kind ?? world.pages.get(id)?.kind ?? "concept";
      const file = path.join(workspace, "wiki", DIRECTORY[kind], `${id}.md`);
      const name = world.pages.get(id)?.name ?? args.about;
      const certainty: Certainty = args.certainty;
      applyOperation(file, (raw) =>
        withNote(raw ?? newPage(name, source), {
          date: simDate(),
          source,
          certainty,
          text: args.note,
        }),
      );
      return plain(`Noted, about ${name}.`);
    },
  }));

  // Administrative: allowlisted for the system agent only (`openclaw.json`).
  const textResult = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
    details: value,
  });
  api.registerTool({
    name: "wiki_lint",
    label: "Wiki Lint",
    description:
      "Problems in the World Wiki, or in one character's personal wiki when `agent` is given.",
    parameters: {
      type: "object",
      properties: { agent: { type: "string" } },
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { agent } = z.object({ agent: z.string().optional() }).parse(input);
      return textResult(service.lint(agent));
    },
  });
  api.registerTool({
    name: "world_audit",
    label: "World Audit",
    description:
      "Counts for the whole world, plus what lint can't see: characters with no relationships, separate social groups, and how the map divides.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return textResult(service.audit());
    },
  });
  api.registerTool({
    name: "memory_preview",
    label: "Memory Preview",
    description:
      "What a character would have come to mind if they read `text` now, with no model call. Use it to check that someone knows what they should and no more.",
    parameters: {
      type: "object",
      properties: { agent: { type: "string" }, text: { type: "string" } },
      required: ["agent", "text"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { agent, text } = z
        .object({ agent: z.string(), text: z.string() })
        .parse(input);
      const { onYourMind, ids } = await service.prefetch({
        agentId: agent,
        stimulus: text,
        seeds: [],
        now: Date.now(),
      });
      return textResult({ onYourMind, ids });
    },
  });
  api.registerTool({
    name: "knowledge_explain",
    label: "Knowledge Explain",
    description:
      "How deeply a character knows a World Wiki page and why; with no `page`, everything they know by depth.",
    parameters: {
      type: "object",
      properties: { agent: { type: "string" }, page: { type: "string" } },
      required: ["agent"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { agent, page } = z
        .object({ agent: z.string(), page: z.string().optional() })
        .parse(input);
      return textResult(service.explain(agent, page));
    },
  });

  api.registerTool({
    name: "memory_consolidate",
    label: "Consolidate Memory",
    description:
      "Run one character's sleep consolidation now over everything since their last one. Sends their records and pages to the model.",
    parameters: {
      type: "object",
      properties: { agent: { type: "string" } },
      required: ["agent"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { agent } = z.object({ agent: z.string() }).parse(input);
      await sleep.consolidate(agent);
      return textResult(await sleep.runs(agent));
    },
  });
  api.registerTool({
    name: "memory_restore",
    label: "Restore Memory",
    description:
      "Undo one sleep pass: every file it touched goes back as it was. The run id is in the memory.consolidated journal event.",
    parameters: {
      type: "object",
      properties: { agent: { type: "string" }, run: { type: "string" } },
      required: ["agent", "run"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { agent, run } = z
        .object({ agent: z.string(), run: z.string() })
        .parse(input);
      return textResult({ restored: await sleep.restore(agent, run) });
    },
  });

  const route = createRouteRegistrar(api);
  const params = (req: { url?: string }): URLSearchParams =>
    new URL(req.url ?? "/", "http://localhost").searchParams;
  const listItem = (page: Page): WikiListItem => ({
    id: page.id,
    kind: page.kind,
    name: page.name,
    summary: page.summary,
  });
  const fullPage = (page: Page): WikiPage => ({
    ...listItem(page),
    aliases: [...page.aliases],
    lead: page.lead,
    sections: page.sections.map((section) => ({
      ...section,
      knownBy: [...section.knownBy],
    })),
    notes: page.notes.map((note) => ({ ...note })),
    history: page.history.map((line) => ({ ...line })),
    openThreads: [...page.openThreads],
    knownBy: [...page.knownBy],
    ...(page.theyThinkOfMe ? { theyThinkOfMe: page.theyThinkOfMe } : {}),
    ...(page.relation ? { relation: page.relation } : {}),
    ...(page.community ? { community: page.community } : {}),
    ...(page.renown ? { renown: page.renown } : {}),
    ...(page.seen ? { seen: page.seen } : {}),
  });
  route("wiki", "GET", async (req, res) => {
    const agent = params(req).get("agent");
    const pages = agent
      ? index.personal(agent).values()
      : index.world().pages.values();
    sendJson(res, 200, {
      pages: [...pages].map(listItem),
    } satisfies WikiListResponse);
  });
  route("wiki/page", "GET", async (req, res) => {
    const query = params(req);
    const id = query.get("id");
    if (!id) {
      sendJson(res, 400, { error: "Missing required id query parameter." });
      return;
    }
    const agent = query.get("agent");
    const world = index.world().pages.get(id);
    const personal = agent ? index.personal(agent).get(id) : undefined;
    sendJson(res, 200, {
      ...(world ? { world: fullPage(world) } : {}),
      ...(personal ? { personal: fullPage(personal) } : {}),
      ...(agent && world
        ? { knowledge: index.world().depth(agent, id, Boolean(personal)) }
        : {}),
    } satisfies WikiPageResponse);
  });
  // Sleep on it now, on request; the same pass a long sleep starts.
  route("memory/consolidate", "POST", async (req, res) => {
    const { agent } = z
      .object({ agent: z.string().min(1) })
      .parse(await readJsonBody(req));
    await sleep.consolidate(agent);
    sendJson(res, 200, { runs: (await sleep.runs(agent)).length });
  });
  route("memory/runs", "GET", async (req, res) => {
    const agent = params(req).get("agent");
    if (!agent) {
      sendJson(res, 400, { error: "Missing required agent query parameter." });
      return;
    }
    sendJson(res, 200, {
      runs: (await sleep.runs(agent)).map((run) => ({
        id: run.id,
        at: run.at,
        files: Object.entries(run.preimages).map(([file, before]) => ({
          path: file,
          before,
          after: run.postimages[file] ?? null,
        })),
      })),
    } satisfies MemoryRunsResponse);
  });
  route("wiki/lint", "GET", async (req, res) => {
    const agent = params(req).get("agent") ?? undefined;
    sendJson(res, 200, {
      findings: [...service.lint(agent)],
    } satisfies WikiLintResponse);
  });
  route("knowledge/explain", "GET", async (req, res) => {
    const agent = params(req).get("agent");
    if (!agent) {
      sendJson(res, 400, { error: "Missing required agent query parameter." });
      return;
    }
    sendJson(
      res,
      200,
      service.explain(agent, params(req).get("page") ?? undefined),
    );
  });
  // Retrieval with no model call: what a turn would recall for this text.
  route("memory/preview", "GET", async (req, res) => {
    const query = params(req);
    const agent = query.get("agent");
    if (!agent) {
      sendJson(res, 400, { error: "Missing required agent query parameter." });
      return;
    }
    const request: RetrievalRequest = {
      agentId: agent,
      stimulus: query.get("text") ?? "",
      seeds: query.getAll("seed"),
      now: Number(query.get("now") ?? Date.now()),
    };
    sendJson(res, 200, {
      ...(await service.prefetch(request)),
      entities: service.entities(request).map((entity) => ({
        id: entity.id,
        depth: entity.knowledge.depth,
        why: entity.knowledge.why,
        signals: entity.signals,
        score: entity.score,
      })),
    });
  });

  return service;
}
