import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  OUTFIT,
  StatSetPayloadSchema,
  coerceStat,
  statMoved,
  statStanding,
  statValue,
  statsOf,
  wornOutfit,
  type StatAuthor,
  type StatCatalog,
  type StatDefinition,
  type StatEntry,
  type StatRecord,
  type StatSetPayload,
  type StatValue,
  type StatValueDef,
} from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import { personName } from "../identity.ts";
import { personLabel } from "../person-label.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { describeTool, pluginSkillText } from "../skill-text.ts";
import type { StateStore } from "../state.ts";
import { declaredOutfits } from "../stickers/stickers.ts";
import type { TaskExtension } from "../taskman/types.ts";
import {
  catalogFile,
  catalogRevision,
  statsFile,
  type CatalogFile,
} from "./catalog.ts";
import {
  WORLD_KEY,
  changesParameter,
  describeStat,
  entry,
  ownChanges,
  ownChoices,
  reviewText,
  reviewedChanges,
  statsText,
  withEntry,
  type StatChange,
  type StatPerson,
} from "./stats.ts";

export interface StatsService {
  /** The world's states as defined now. */
  readonly catalog: () => StatCatalog;
  /**
   * One person's states: the world's that exist for them, and their outfit if
   * they have any.
   */
  readonly statsOf: (characterId: string) => StatCatalog;
  /** A character's outfits besides their usual clothes. */
  readonly outfits: (characterId: string) => readonly StatValueDef[];
  /**
   * The outfit word a character wears, or nothing in their usual clothes.
   * Synchronous, for tool factories: from memory, filled by `load`.
   */
  readonly wearing: (characterId: string) => string | undefined;
  /** Reads what everyone wears into memory, once the Gateway has started. */
  readonly load: () => Promise<void>;
  /**
   * Replaces the world's states. Values already set stay in the store. With the
   * revision the change was made from, throws `StaleCatalogError` when the
   * states have changed since.
   */
  readonly saveCatalog: (catalog: StatCatalog, base?: string) => void;
  readonly record: (characterId: string) => Promise<StatRecord | undefined>;
  readonly world: () => Promise<StatRecord | undefined>;
  /** Sets one value by hand; throws with what is wrong with the request. */
  readonly set: (change: StatSetPayload, by: StatAuthor) => Promise<StatRecord>;
  /** Adds `changes` to `start_task` for a character with states they set. */
  readonly taskExtension: TaskExtension;
  /** A character changes one of their own states, mid-activity. */
  readonly change: (
    agentId: string,
    name: string,
    value: unknown,
  ) => Promise<string>;
  /** The `Your state` lines of a brain turn. */
  readonly situation: (
    agentId: string,
    here: readonly string[],
    prompt: string,
  ) => Promise<string | undefined>;
  /** States a night's sleep reviews, among the people of the day. */
  readonly review: {
    readonly text: (
      agentId: string,
      people: readonly string[],
    ) => Promise<string | undefined>;
    readonly apply: (
      agentId: string,
      people: readonly string[],
      answer: unknown,
    ) => Promise<void>;
  };
}

/*
 * A change reads a record, alters it and writes it back, and may come from
 * another instance of this plugin (see `realtime.ts`), so changes to one record
 * queue behind each other process-wide.
 */
const SHARED_QUEUES = Symbol.for("kazusa.stats.queues");
function queues(): Map<string, Promise<unknown>> {
  const scope = globalThis as {
    [SHARED_QUEUES]?: Map<string, Promise<unknown>>;
  };
  const existing = scope[SHARED_QUEUES];
  if (existing) return existing;
  const created = new Map<string, Promise<unknown>>();
  scope[SHARED_QUEUES] = created;
  return created;
}

/** What each character's outfit stands at, for synchronous readers. */
const SHARED_WORN = Symbol.for("kazusa.stats.worn");
function worn(): Map<string, StatEntry | undefined> {
  const scope = globalThis as {
    [SHARED_WORN]?: Map<string, StatEntry | undefined>;
  };
  const existing = scope[SHARED_WORN];
  if (existing) return existing;
  const created = new Map<string, StatEntry | undefined>();
  scope[SHARED_WORN] = created;
  return created;
}

/** A save made from a catalog that has changed since. */
export class StaleCatalogError extends Error {
  constructor() {
    super("The states changed since you opened them.");
    this.name = "StaleCatalogError";
  }
}

/** People named by what arrived whose states toward are shown. */
const NAMED_SHOWN = 4;

/** What a value has to be, for whoever gave one the state can't hold. */
function allowed(stat: StatDefinition): string {
  return stat.kind === "choice"
    ? `${stat.name} is one of: ${stat.values.map(({ name }) => name).join(", ")}.`
    : `${stat.name} is a number from ${stat.min} to ${stat.max}.`;
}

/** The same for a character, who moves a state with bands by direction. */
function movable(stat: StatDefinition): string {
  return stat.kind === "number" && stat.bands?.length
    ? `${stat.name} moves a step at a time: give "up" or "down".`
    : allowed(stat);
}

export function createStats(deps: {
  readonly file: CatalogFile;
  readonly store: StateStore<StatRecord>;
  readonly now: () => number;
  /** Characters and players a state can be on or toward. */
  readonly isPerson: (id: string) => boolean;
  /** The human player, who alone has the `player` states. */
  readonly isPlayer: (id: string) => boolean;
  /** A character's outfits besides the usual clothes; none for a player. */
  readonly outfitsOf?: (id: string) => readonly StatValueDef[];
  readonly labelOf: (id: string) => Promise<string>;
  /** A section of a skill, filled. */
  readonly text: (
    ref: string,
    values?: Readonly<Record<string, string | number>>,
    agentId?: string,
  ) => string;
  readonly onChange?: (
    characterId: string | undefined,
    record: StatRecord,
  ) => void;
  readonly onCatalog?: () => void;
  readonly warn?: (message: string) => void;
}): StatsService {
  const { file, store, now, isPerson } = deps;
  const outfits = (id: string) => deps.outfitsOf?.(id) ?? [];
  const statsFor = (id: string) =>
    statsOf(file.read(), {
      player: deps.isPlayer(id),
      outfits: outfits(id),
    });
  /** The people a holder's states are toward. */
  const towardThem = (holder: string, ids: readonly string[]): StatPerson[] =>
    [...new Set(ids)]
      .filter((id) => id !== holder && isPerson(id))
      .map((id) => ({ id }));
  const labelOf = async (id: string) => personLabel(await deps.labelOf(id), id);

  /**
   * Writes one subject's changes, one caller at a time. Changes worked out from
   * where a value stands are given as a function of the record, so two moves at
   * once each start from the other's result; one that throws writes nothing.
   */
  const apply = (
    key: string,
    changes:
      | readonly StatChange[]
      | ((record: StatRecord | undefined) => readonly StatChange[]),
    by: StatAuthor,
    reset?: { readonly name: string; readonly toward?: string },
  ): Promise<StatRecord> => {
    const run = async () => {
      let record = await store.lookup(key);
      const planned = typeof changes === "function" ? changes(record) : changes;
      if (!planned.length && !reset) return record ?? { own: {}, toward: {} };
      for (const { stat, toward, value } of planned)
        record = withEntry(
          record,
          { name: stat.name, ...(toward ? { toward } : {}) },
          entry(value, now(), by),
        );
      if (reset) record = withEntry(record, reset, undefined);
      const next = record ?? { own: {}, toward: {} };
      await store.register(key, next);
      worn().set(key, next.own[OUTFIT]);
      deps.onChange?.(key === WORLD_KEY ? undefined : key, next);
      return next;
    };
    const queued = (queues().get(key) ?? Promise.resolve()).then(run, run);
    queues().set(
      key,
      queued.catch(() => {}),
    );
    return queued;
  };

  const taskExtension: TaskExtension = {
    startTaskParameters: {},
    startTaskParametersFor(agentId) {
      const changes = agentId ? changesParameter(statsFor(agentId)) : undefined;
      return changes ? { changes } : {};
    },
    delayTaskParameters: {},
    // Required like `afterwards`: an optional parameter is never filled.
    required: ["changes"],
    async prepare({ kind, agentId, params }) {
      const changes =
        kind === "started"
          ? ownChanges(
              statsFor(agentId),
              await store.lookup(agentId),
              params.changes,
            )
          : [];
      if (!changes.length) return { commit: async () => {} };
      return {
        note: changes
          .map(
            ({ stat, value }) =>
              ` ${deps.text(
                "kazusa-results#state-changed",
                { name: stat.name, value: statStanding(stat, value) },
                agentId,
              )}`,
          )
          .join(""),
        payload: {
          states: Object.fromEntries(
            changes.map(({ stat, value }) => [stat.name, value]),
          ),
        },
        // Worked out again when written: another change may have landed.
        commit: async () => {
          await apply(
            agentId,
            (record) => ownChanges(statsFor(agentId), record, params.changes),
            "character",
          );
        },
      };
    },
  };

  return {
    catalog: () => file.read(),
    statsOf: statsFor,
    outfits,
    wearing(characterId) {
      const at = worn().get(characterId);
      return wornOutfit(outfits(characterId), {
        own: at ? { [OUTFIT]: at } : {},
        toward: {},
      });
    },
    async load() {
      for (const { key, value } of await store.entries())
        worn().set(key, value.own[OUTFIT]);
    },
    saveCatalog(catalog, base) {
      if (base !== undefined && base !== catalogRevision(file.read()))
        throw new StaleCatalogError();
      file.write(catalog);
      deps.onCatalog?.();
    },
    record: (characterId) => store.lookup(characterId),
    world: () => store.lookup(WORLD_KEY),
    async set(change, by) {
      const { name, characterId, toward, value } = change;
      // Everything defined: who it exists for is said below, not hidden.
      const stat = statsOf(file.read(), {
        player: true,
        ...(characterId ? { outfits: outfits(characterId) } : {}),
      }).find((entry) => entry.name === name);
      if (!stat)
        throw new Error(
          name === OUTFIT
            ? "They have no outfits besides their usual clothes."
            : `No state is called ${name}.`,
        );
      if ((stat.on === "world") !== (characterId === undefined))
        throw new Error(
          stat.on === "world"
            ? `${name} is a state of the world, not of a character.`
            : `${name} needs who it is on.`,
        );
      if ((stat.on === "pair") !== (toward !== undefined))
        throw new Error(
          stat.on === "pair"
            ? `${name} needs who it is toward.`
            : `${name} is not a state toward someone.`,
        );
      for (const id of [characterId, toward])
        if (id !== undefined && !isPerson(id))
          throw new Error(`Nobody here is ${id}.`);
      if (
        stat.on === "player" &&
        characterId !== undefined &&
        !deps.isPlayer(characterId)
      )
        throw new Error(
          `${name} is a state of the player, not of a character.`,
        );
      if (toward !== undefined && toward === characterId)
        throw new Error(`${name} is toward someone else.`);
      const key = characterId ?? WORLD_KEY;
      const target = { name, ...(toward ? { toward } : {}) };
      if (value === null) return apply(key, [], by, target);
      const next = coerceStat(stat, value);
      if (next === undefined) throw new Error(allowed(stat));
      return apply(
        key,
        [{ stat, value: next, ...(toward ? { toward } : {}) }],
        by,
      );
    },
    taskExtension,
    async change(agentId, name, value) {
      const stat = ownChoices(statsFor(agentId)).find(
        (entry) => entry.name === name,
      );
      if (!stat)
        throw new Error(
          deps.text("kazusa-results#state-not-yours", { name }, agentId),
        );
      let result = "kazusa-results#state-unchanged";
      let stands: StatValue = stat.initial;
      await apply(
        agentId,
        (record) => {
          const current = statValue(stat, record?.own[name]);
          const next = statMoved(stat, current, value);
          if (next === undefined) throw new Error(movable(stat));
          stands = next;
          if (next === current) return [];
          result = "kazusa-results#state-changed";
          return [{ stat, value: next }];
        },
        "character",
      );
      return deps.text(
        result,
        { name, value: statStanding(stat, stands) },
        agentId,
      );
    },
    async situation(agentId, here, prompt) {
      const catalog = statsFor(agentId);
      const others = towardThem(agentId, here);
      // What shows on each of them.
      const theirs = others.map((person) => ({
        ...person,
        catalog: statsFor(person.id),
      }));
      if (
        !catalog.some(({ shown }) => shown !== "nobody") &&
        !theirs.some((person) =>
          person.catalog.some(({ shown }) => shown === "everyone"),
        )
      )
        return undefined;
      const record = await store.lookup(agentId);
      // Toward whoever is at hand: with them, or named by what arrived,
      // whether or not anything is set toward them yet. A few at most: one
      // text names its sender, a busy group chat everyone.
      const named = towardThem(
        agentId,
        [...prompt.matchAll(/`([^`\s]+)`/gu)]
          .map(([, id]) => id)
          .filter((id) => !others.some((person) => person.id === id)),
      ).slice(0, NAMED_SHOWN);
      const labelled = async <T extends StatPerson>(person: T) => ({
        ...person,
        label: await labelOf(person.id),
      });
      const [toward, present, world] = await Promise.all([
        catalog.some((stat) => stat.on === "pair" && stat.shown !== "nobody")
          ? Promise.all([...others, ...named].map(labelled))
          : [],
        Promise.all(
          theirs.map(async (person) => ({
            ...(await labelled(person)),
            record: await store.lookup(person.id),
          })),
        ),
        store.lookup(WORLD_KEY),
      ]);
      return statsText({ catalog, record, world, toward, present });
    },
    review: {
      async text(agentId, people) {
        const others = towardThem(agentId, people);
        return reviewText(
          statsFor(agentId),
          await store.lookup(agentId),
          await Promise.all(
            others.map(async (person) => ({
              ...person,
              label: await labelOf(person.id),
            })),
          ),
        );
      },
      async apply(agentId, people, answer) {
        await apply(
          agentId,
          (record) =>
            reviewedChanges(
              statsFor(agentId),
              record,
              answer,
              towardThem(agentId, people),
            ),
          "reviewed",
        );
      },
    },
  };
}

/**
 * Registers the `"stats"` store, the task extension, a character's
 * `change_state` and the system agent's `set_state`.
 */
export function registerStats(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Clock;
    readonly broadcaster: KazusaRealtimeBroadcaster;
  },
): StatsService {
  const text = pluginSkillText(api);
  const user = api.pluginConfig?.user as { readonly id?: string } | undefined;
  const playerId = user?.id ?? "user:sensei";
  const isAgent = (id: string) => listAgentIds(currentConfig(api)).includes(id);
  const stats = createStats({
    file: catalogFile(statsFile(), (message) => api.logger.warn(message)),
    store: api.runtime.state.openKeyedStore<StatRecord>({
      namespace: "stats",
      retention: "retained",
    }),
    now: () => deps.clock.time(),
    isPerson: (id) => id === playerId || isAgent(id),
    isPlayer: (id) => id === playerId,
    outfitsOf: (id) =>
      isAgent(id)
        ? [
            ...declaredOutfits(
              api.runtime.agent.resolveAgentWorkspaceDir(
                currentConfig(api),
                id,
              ),
            ),
          ].map(([name, description]) => ({ name, description }))
        : [],
    labelOf: (id) => personName(api, id, currentConfig(api)),
    text: (ref, values, agentId) =>
      text(ref, values, agentId ? { agentId } : undefined),
    onChange: (characterId, record) =>
      deps.broadcaster.broadcast({
        type: "stats",
        ...(characterId ? { characterId } : {}),
        record,
      }),
    onCatalog: () =>
      deps.broadcaster.broadcast({ type: "stats", catalog: true }),
    warn: (message) => api.logger.warn(message),
  });

  // What everyone wears, for tool factories, which can't wait on a store.
  api.on("gateway_start", async () => {
    await stats.load().catch((error: unknown) => {
      api.logger.warn(
        `Stats: could not read what everyone wears: ${String(error)}`,
      );
    });
  });

  // A character's own states, mid-activity. Absent while they have none.
  api.registerTool((toolContext) => {
    const agentId = toolContext?.agentId;
    const own = agentId ? ownChoices(stats.statsOf(agentId)) : [];
    if (!agentId || !own.length) return null;
    return {
      ...describeTool(
        text,
        {
          name: "change_state",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                enum: own.map(({ name }) => name),
                description: own.map(describeStat).join("\n"),
              },
              value: { type: ["string", "number"] },
            },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
        {},
        { agentId },
      ),
      label: "Change State",
      async execute(_id: string, input: unknown) {
        await deps.clock.init();
        const { name, value } = input as { name?: unknown; value?: unknown };
        const said = await stats.change(agentId, String(name), value);
        return {
          content: [{ type: "text" as const, text: said }],
          details: {},
        };
      },
    };
  });

  // Administrative: allowlisted for the system agent only.
  api.registerTool(() => ({
    name: "set_state",
    label: "Set State",
    description:
      "Set one of the world's states (defined in `shared/stats.json`) to a value: `characterId` for a state on a character (the player's id for a state of the player), `toward` as well for one character's state toward another, neither for a state of the world. A `null` value puts it back to its initial. To define, change or remove states, edit `shared/stats.json`.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        characterId: { type: "string" },
        toward: { type: "string" },
        value: { type: ["string", "number", "null"] },
      },
      required: ["name", "value"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      await deps.clock.init();
      const record = await stats.set(
        StatSetPayloadSchema.parse(input),
        "system",
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(record, null, 1) },
        ],
        details: record,
      };
    },
  }));
  return stats;
}
