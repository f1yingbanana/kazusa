import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import {
  WikiDeletePayloadSchema,
  WikiKindSchema,
  WikiRenamePayloadSchema,
  WikiSavePayloadSchema,
  type WikiEditResult,
  type MemoryRunsResponse,
  type WikiLintResponse,
  type WikiListItem,
  type WikiListResponse,
  type WikiPage,
  type WikiPageResponse,
} from "@kazusa/client";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
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
import type { Clock } from "../clock/clock.ts";
import { pluginSkillLoader } from "../context-engine/skill-loader.ts";
import { resolveStateDir } from "../state-dir.ts";
import { createSkillText, describeTool } from "../skill-text.ts";
import { appendLedgerEntry } from "../ledger.ts";
import { withJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";
import { createSleep, type SleepPass, type SleepState } from "./sleep.ts";
import {
  embedPending,
  embedQuery,
  openAiEmbedder,
  type Embedder,
} from "./embeddings.ts";
import { modelsConfig } from "../models/config.ts";
import { modelSelection } from "../models/selection.ts";
import {
  configuredChoice,
  registerEmbeddingModels,
} from "./embedding-models.ts";
import { MemoryIndex, WORLD_SCOPE } from "./index.ts";
import type { Anchors } from "./knowledge.ts";
import { lintMap } from "../location/world.ts";
import { renamedText } from "../location/pages.ts";
import type { PlaceEdits } from "../location/register.ts";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import { auditWorld, workspacesBeside, type WorldAudit } from "./audit.ts";
import { lintPersonal, lintWorld, type LintFinding } from "./lint.ts";
import type { Certainty, HistoryLine, Page } from "./page.ts";
import { renderEntity, renderOnYourMind, renderRoster } from "./render.ts";
import {
  mentionsIn,
  retrieve,
  searchText,
  type RetrievalRequest,
} from "./retrieve.ts";
import {
  applyOperation,
  newPage,
  withField,
  withNote,
  plansOn,
  withPlan,
} from "./writes.ts";
import { MEMORY_CONFIG } from "./config.ts";
import {
  deleteSource,
  PAGE_DIRECTORY,
  readSource,
  saveSource,
  SourceConflict,
} from "./source.ts";
import {
  createFamiliarity,
  type FamiliarityRecord,
  type FamiliarityService,
} from "./familiarity.ts";

export interface MemoryPrefetch {
  /** `On your mind`, empty when nothing came up. */
  readonly onYourMind: string;
  /** `People you know`. */
  readonly roster: string;
  readonly ids: readonly string[];
}

export interface RememberedPlace {
  readonly id: string;
  readonly byName: boolean;
}

/** How long a started query embedding waits to be used. */
const QUERY_VECTOR_TTL_MS = 120_000;
/** At most this many recent query embeddings are kept. */
const QUERY_VECTOR_LIMIT = 256;

interface QueryVectorCache {
  readonly entries: Map<
    string,
    {
      readonly at: number;
      readonly vector: Promise<Float32Array | undefined>;
      /** Started by `warm`, and not yet read by a turn. */
      unused: boolean;
    }
  >;
  /** Embeddings `warm` started. */
  warmed: number;
  /** Turns that found theirs started or done. */
  hits: number;
  /** Turns that had to start their own. */
  misses: number;
  /** Warmed embeddings no turn read before they left. */
  wasted: number;
}

const QUERY_VECTORS = Symbol.for("kazusa.queryVectors");

/** The process's query embeddings, shared by every registration. */
function queryVectorCache(): QueryVectorCache {
  const holder = globalThis as { [QUERY_VECTORS]?: QueryVectorCache };
  return (holder[QUERY_VECTORS] ??= {
    entries: new Map(),
    warmed: 0,
    hits: 0,
    misses: 0,
    wasted: 0,
  });
}

/** Forget every query embedding and count, as at process start. */
export function resetQueryVectors(): void {
  const cache = queryVectorCache();
  cache.entries.clear();
  cache.warmed = cache.hits = cache.misses = cache.wasted = 0;
}

/** How many query embeddings are kept, and how often warming paid off. */
export function queryVectorStats(): Omit<QueryVectorCache, "entries"> & {
  readonly entries: number;
} {
  const { entries, ...counts } = queryVectorCache();
  return { ...counts, entries: entries.size };
}

/**
 * One embedding per model and text, shared for two minutes: a turn reuses one
 * Perception started at handoff. Expired and least recent entries leave; a
 * failed one leaves at once, so the next asks again.
 */
export async function queryVectorFor(
  embedder: Pick<Embedder, "model">,
  text: string,
  warming: boolean,
  embed: (text: string) => Promise<Float32Array | undefined>,
): Promise<Float32Array | undefined> {
  const cache = queryVectorCache();
  const now = Date.now();
  for (const [key, entry] of cache.entries) {
    if (now - entry.at < QUERY_VECTOR_TTL_MS) break;
    if (entry.unused) cache.wasted += 1;
    cache.entries.delete(key);
  }
  const key = `${embedder.model}\u0000${text}`;
  const found = cache.entries.get(key);
  if (found) {
    if (!warming) {
      if (found.unused) cache.hits += 1;
      found.unused = false;
    }
    return found.vector;
  }
  if (warming) cache.warmed += 1;
  else cache.misses += 1;
  const vector = embed(text);
  const entry = { at: now, vector, unused: warming };
  cache.entries.set(key, entry);
  void vector.then((value) => {
    if (!value && cache.entries.get(key) === entry) cache.entries.delete(key);
  });
  while (cache.entries.size > QUERY_VECTOR_LIMIT) {
    const [oldest, first] = cache.entries.entries().next().value!;
    if (first.unused) cache.wasted += 1;
    cache.entries.delete(oldest);
  }
  return vector;
}

export interface MemoryService {
  /**
   * Starts the embedding `prefetch` will want for this request, without
   * waiting: Perception calls it as it hands a brain its messages, so the
   * turn's first build finds the embedding started or done.
   */
  readonly warm: (request: RetrievalRequest) => void;
  readonly prefetch: (
    request: RetrievalRequest,
    options?: {
      readonly maxTokens?: number;
      readonly rosterLimit?: number;
      /** Already shown this turn (who is here): not listed again. */
      readonly exclude?: readonly string[];
    },
  ) => Promise<MemoryPrefetch>;
  /** They did something with these at `at`: familiarity (`familiarity.ts`). */
  readonly use: FamiliarityService["use"];
  /** How familiar each person and place is to them now, by page id. */
  readonly familiarity: (
    agentId: string,
    now: number,
  ) => Promise<ReadonlyMap<string, number>>;
  /** World events at this place since they last saw it, in the world's words. */
  readonly placeChanges: (
    agentId: string,
    placeId: string,
    now: number,
  ) => readonly string[];
  /** They took the place in: stamps their card and notes what changed. */
  readonly visited: (agentId: string, placeId: string, now: number) => void;
  /**
   * Their own places this text brings up: `byName` when it names one (a name or
   * alias in it), not just shares a word with its page.
   */
  readonly places: (
    agentId: string,
    text: string,
    now: number,
  ) => readonly RememberedPlace[];
  /** Whole entities, one string each, for the decision context. */
  readonly recollections: (
    request: RetrievalRequest,
    limit: number,
  ) => readonly string[];
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
    /** Location registers later; it edits place pages so the map holds. */
    readonly places?: { current?: PlaceEdits };
  },
): MemoryService {
  const config = MEMORY_CONFIG.parse(
    (api.pluginConfig as { memory?: unknown } | undefined)?.memory ?? {},
  );
  const worldDir = config.wikiDir ?? sharedDir("wiki");
  const index = sharedIndex(
    api,
    worldDir,
    configuredChoice(config.embedding).vectors,
    config.anchors,
  );
  const nameOf = (id: string): string | undefined =>
    index.world().pages.get(id)?.name;
  const familiarity = createFamiliarity(
    api.runtime.state.openKeyedStore<FamiliarityRecord>({
      namespace: "familiarity",
      retention: "retained",
    }),
    config.familiarity,
  );
  const familiarTo = (agentId: string, now: number) =>
    familiarity.scores(agentId, now, index.personal(agentId).values());
  const warn = (message: string): void => {
    api.logger.warn(message);
  };

  const models = registerEmbeddingModels(api, {
    selection: modelSelection(api),
    configured: configuredChoice(config.embedding),
    config: modelsConfig(api.pluginConfig),
    useVectors: (vectors) => index.useVectors(vectors),
    progress: () => {
      index.world(); // loads the world wiki if no turn has yet
      return index.embeddingProgress();
    },
    fillIn: () => embedInBackground(),
  });
  /** The chosen model, asked for per use: a key or a switch applies at once. */
  const currentEmbedder = async (): Promise<Embedder | undefined> => {
    const choice = await models.current().catch((error: unknown) => {
      warn(`Memory: keywords only, no embedding choice: ${String(error)}`);
      return undefined;
    });
    if (!choice || !models.usable(choice)) return undefined;
    index.useVectors(choice.vectors);
    return openAiEmbedder({
      baseUrl: choice.baseUrl,
      model: choice.model,
      apiKey: async () =>
        (
          await api.runtime.modelAuth.resolveApiKeyForProvider({
            provider: choice.provider,
          })
        ).apiKey,
    });
  };
  /** One background embed at a time; a turn never waits for it. */
  let embedding = false;
  function embedInBackground(agentId?: string): void {
    if (embedding) return;
    embedding = true;
    void currentEmbedder()
      .then((embedder) => embedder && embedPending(index, embedder, agentId))
      .catch((error: unknown) => {
        warn(`Memory: embedding failed: ${String(error)}`);
      })
      .finally(() => {
        embedding = false;
      });
  }
  const withVector = async (
    request: RetrievalRequest,
    warming = false,
  ): Promise<RetrievalRequest> => {
    const embedder = await currentEmbedder();
    const queryVector =
      embedder &&
      (await queryVectorFor(embedder, searchText(request), warming, (text) =>
        embedQuery(embedder, text, warn),
      ));
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
  const skills = pluginSkillLoader(api);
  const text = createSkillText(skills);
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

  /** Today's plans from MEMORY.md, which a query falls back to with no words. */
  const plansFor = (agentId: string, now: number): string[] => {
    const memory = path.join(workspaceOf(agentId), "MEMORY.md");
    return plansOn(
      existsSync(memory) ? readFileSync(memory, "utf8") : "",
      new Date(now).toISOString().slice(0, 10),
    );
  };

  const service: MemoryService = {
    sleep,
    warm: (request) => {
      void withVector(
        { ...request, plans: plansFor(request.agentId, request.now) },
        true,
      ).catch((error: unknown) => {
        warn(`Memory: could not start an embedding early: ${String(error)}`);
      });
    },
    prefetch: async (request, options) => {
      const familiar = await familiarTo(request.agentId, request.now);
      const plans = plansFor(request.agentId, request.now);
      const entities = retrieve(
        index,
        await withVector({ ...request, plans, familiarity: familiar }),
      );
      embedInBackground(request.agentId);
      const { text, ids } = renderOnYourMind(entities, {
        maxTokens: options?.maxTokens ?? config.maxTokens,
        estimate,
        nameOf,
      });
      return {
        onYourMind: text,
        ids,
        // Nobody twice: not who is On your mind or in front of them.
        roster: renderRoster(
          index.personal(request.agentId).values(),
          options?.rosterLimit ?? config.rosterLimit,
          nameOf,
          familiar,
          new Set([...ids, ...(options?.exclude ?? [])]),
        ),
      };
    },
    use: familiarity.use,
    familiarity: familiarTo,
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
        path.join(workspace, "wiki", PAGE_DIRECTORY.place, `${placeId}.md`),
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
        .map((entity) => ({
          id: entity.id,
          byName: entity.signals.includes("mention"),
        })),
    recollections: (request, limit) =>
      retrieve(index, request)
        .filter((entity) => entity.signals.some((s) => s !== "salience"))
        .slice(0, limit)
        .map((entity) => renderEntity(entity, nameOf)),
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

  // Their wording is the `kazusa-tools` skill's.
  const worded = <P>(name: string, parameters: P, agentId?: string) =>
    describeTool(text, { name, parameters }, {}, agentId ? { agentId } : {});

  api.registerTool((context) => ({
    ...worded(
      "recall",
      {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      context.agentId,
    ),
    catalogMode: "direct-only",
    label: "Recall",
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
    ...worded(
      "look_up",
      {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      },
      context.agentId,
    ),
    catalogMode: "direct-only",
    label: "Look Up",
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
    ...worded(
      "remember",
      {
        type: "object",
        properties: {
          about: { type: "string" },
          note: { type: "string" },
          source: { type: "string" },
          certainty: { type: "string", enum: [...CERTAINTIES] },
          on: { type: "string" },
        },
        required: ["about", "note"],
        additionalProperties: false,
      },
      context.agentId,
    ),
    catalogMode: "direct-only",
    label: "Remember",
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
      const file = path.join(
        workspace,
        "wiki",
        PAGE_DIRECTORY[kind],
        `${id}.md`,
      );
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
  /** The world's wiki, or one character's; never a path the request names. */
  const wikiRoot = (agent: string | null | undefined): string => {
    if (!agent) return worldDir;
    if (!listAgentIds(currentConfig(api)).includes(agent))
      throw new Error(`No character called ${agent}.`);
    return path.join(workspaceOf(agent), "wiki");
  };
  // Editing by hand: the Markdown is the page, so the next turn reads it.
  route("wiki/source", "GET", async (req, res) => {
    const query = params(req);
    const id = WikiSavePayloadSchema.shape.id.parse(query.get("id"));
    const kind = WikiKindSchema.optional().parse(
      query.get("kind") ?? undefined,
    );
    const agent = query.get("agent");
    // A new page of theirs goes where the world keeps the same thing.
    const fallback = kind ?? index.world().pages.get(id)?.kind;
    sendJson(res, 200, readSource(wikiRoot(agent), id, fallback));
  });
  const PLACE_ID_FIELD = z.object({ place_id: z.string().optional() });
  /** Where place pages live, as `readSource` reports paths. */
  const PLACES_PATH = `${PAGE_DIRECTORY.place.split(path.sep).join("/")}/`;
  const placeIdIn = (text: string): string | undefined => {
    try {
      return readFrontmatter(text, PLACE_ID_FIELD).data.place_id;
    } catch {
      return undefined;
    }
  };
  /** Kept, never gone for good: a person can put a page back by hand. */
  const trashDir = (scope: string) =>
    path.join(
      resolveStateDir(process.env, homedir()),
      "kazusa",
      "wiki-trash",
      new Date().toISOString().replace(/[:.]/g, "-"),
      scope,
    );
  const conflict = (res: ServerResponse, error: unknown): void => {
    if (!(error instanceof SourceConflict)) throw error;
    sendJson(res, 409, { error: error.message, current: error.current });
  };
  route("wiki/save", "POST", async (req, res) => {
    const payload = WikiSavePayloadSchema.parse(await readJsonBody(req));
    const kind = payload.kind ?? index.world().pages.get(payload.id)?.kind;
    const root = wikiRoot(payload.agent);
    try {
      // A world place saved under a new `place_id` is renamed, so whatever
      // names it, and whoever is there, follows instead of losing it.
      const current = readSource(root, payload.id, kind);
      const from =
        current.exists && current.path.startsWith(PLACES_PATH)
          ? placeIdIn(current.text)
          : undefined;
      const to = placeIdIn(payload.text);
      const places = deps.places?.current;
      if (
        !payload.agent &&
        places &&
        from !== undefined &&
        to !== undefined &&
        from !== to
      ) {
        if (payload.base !== undefined && payload.base !== current.hash)
          throw new SourceConflict(current);
        await places.rename(from, to);
        index.invalidateWorld();
        sendJson(
          res,
          200,
          saveSource(root, {
            id: to,
            kind: "place",
            text: renamedText(payload.text, { [from]: to }),
          }),
        );
        return;
      }
      const saved = saveSource(root, {
        id: payload.id,
        text: payload.text,
        ...(kind ? { kind } : {}),
        ...(payload.base !== undefined ? { base: payload.base } : {}),
      });
      index.invalidateWorld();
      sendJson(res, 200, saved);
    } catch (error) {
      conflict(res, error);
    }
  });
  route("wiki/delete", "POST", async (req, res) => {
    const payload = WikiDeletePayloadSchema.parse(await readJsonBody(req));
    const root = wikiRoot(payload.agent);
    const page = payload.agent
      ? undefined
      : index.world().pages.get(payload.id);
    try {
      const current = readSource(root, payload.id);
      if (
        !current.exists ||
        (payload.base !== undefined && payload.base !== current.hash)
      )
        throw new SourceConflict(current);
      if (
        page?.kind === "person" &&
        listAgentIds(currentConfig(api)).includes(payload.id)
      ) {
        sendJson(res, 400, {
          error: `${payload.id} is a character in this world; their card can't be deleted while they are.`,
        });
        return;
      }
      const places = deps.places?.current;
      const placeId =
        payload.agent || !current.path.startsWith(PLACES_PATH)
          ? undefined
          : placeIdIn(current.text);
      if (placeId !== undefined && places) {
        const { changed, relocated } = await places.remove(
          placeId,
          path.join(root, current.path),
        );
        index.invalidateWorld();
        sendJson(res, 200, {
          id: payload.id,
          changed: [...changed],
          relocated: [...relocated],
        } satisfies WikiEditResult);
        return;
      }
      deleteSource(root, payload, trashDir(payload.agent ?? "world"));
      index.invalidateWorld();
      sendJson(res, 200, {
        id: payload.id,
        changed: [],
        relocated: [],
      } satisfies WikiEditResult);
    } catch (error) {
      conflict(res, error);
    }
  });
  route("wiki/rename", "POST", async (req, res) => {
    const payload = WikiRenamePayloadSchema.parse(await readJsonBody(req));
    const current = readSource(worldDir, payload.id);
    const from =
      current.exists && current.path.startsWith(PLACES_PATH)
        ? placeIdIn(current.text)
        : undefined;
    const places = deps.places?.current;
    if (from === undefined || !places) {
      sendJson(res, 400, { error: "Only World Wiki places can be renamed." });
      return;
    }
    const { changed } = await places.rename(from, payload.to);
    index.invalidateWorld();
    sendJson(res, 200, {
      id: payload.to,
      changed: [...changed],
      relocated: [],
    } satisfies WikiEditResult);
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

  return service;
}
