import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { TaskExtension } from "../taskman/types.ts";
import { DESIRES_CONFIG, type DesiresConfig } from "./config.ts";
import {
  anchorAt,
  drainRates,
  afterwardsParameter,
  delayAfterwardsParameter,
  feelingsLine,
  levelOf,
  levelsAt,
  startEffects,
  stateOf,
  isUnchanged,
  targetOf,
  transitions,
  type DesireRecord,
  type DesireStore,
} from "./desires.ts";

export interface DesiresService {
  readonly config: DesiresConfig;
  readonly store: DesireStore;
  /** Called after every record write (task transitions and `desires.configure`). */
  readonly onChange: (
    listener: (agentId: string, record: DesireRecord) => void,
  ) => () => void;
  /** Adds `afterwards` to both task tools and re-anchors on every transition. */
  readonly taskExtension: TaskExtension;
  /** The `How you feel` line for a brain turn. */
  readonly feelings: (agentId: string, at: number) => Promise<string>;
}

/** Validators bound to one world's catalog and states. */
function createSchemas(config: DesiresConfig) {
  const names = config.catalog.map(({ name }) => name);
  const states = config.states.map(({ name }) => name);
  const desire = z.enum(names);
  const state = z.enum(states);
  const transition = z.enum(transitions(config));
  return {
    effects: z.partialRecord(desire, transition),
    get: z.object({ agentId: z.string().min(1) }),
    configure: z.object({
      agentId: z.string().min(1),
      /** `null` clears the character's override. */
      drain: z
        .partialRecord(desire, z.number().finite().nonnegative().nullable())
        .optional(),
      /** Levels as numbers or state names, applied at the current sim time. */
      levels: z
        .partialRecord(
          desire,
          z.union([z.number().finite().min(0).max(100), state]),
        )
        .optional(),
    }),
  };
}

/** Registers the `"desires"` store, the Taskman extension and `desires.*` RPCs. */
export function registerDesires(
  api: OpenClawPluginApi,
  deps: { readonly clock: Clock },
): DesiresService {
  const { clock } = deps;
  const config = DESIRES_CONFIG.parse(api.pluginConfig?.desires ?? {});
  const schemas = createSchemas(config);
  const store = api.runtime.state.openKeyedStore<DesireRecord>({
    namespace: "desires",
    retention: "retained",
  });
  const listeners = new Set<(agentId: string, record: DesireRecord) => void>();
  const write = async (agentId: string, record: DesireRecord) => {
    await store.register(agentId, record);
    for (const listener of listeners) {
      try {
        listener(agentId, record);
      } catch (error: unknown) {
        api.logger.warn(`Desire change listener failed: ${String(error)}`);
      }
    }
  };

  const taskExtension: TaskExtension = {
    startTaskParameters: { afterwards: afterwardsParameter(config) },
    delayTaskParameters: { afterwards: delayAfterwardsParameter(config) },
    required: ["afterwards"],
    // A delay restates how the rest of the activity will feel, so both tools
    // replace the effects from now until the lease's end.
    async prepare({ agentId, at, params }) {
      const effects = schemas.effects.safeParse(params.afterwards);
      if (!effects.success) {
        throw new Error(
          `invalid afterwards: ${z.prettifyError(effects.error)}`,
        );
      }
      // Only the afterwards state counts; the stated current state is the
      // model's own reasoning aid and may be stale.
      const targets = Object.fromEntries(
        Object.entries(effects.data).flatMap(([name, value]) =>
          value === undefined || isUnchanged(value)
            ? []
            : [[name, targetOf(value)]],
        ),
      );
      const anchored = anchorAt(config, await store.lookup(agentId), at);
      return {
        // Against the lease as written, which may end earlier than asked.
        commit: (task) =>
          write(
            agentId,
            startEffects(
              config,
              anchored,
              { id: task.id, until: Date.parse(task.endAt) },
              targets,
            ),
          ),
      };
    },
  };

  const describe = (agentId: string, record: DesireRecord | undefined) => {
    const at = clock.time();
    const levels = levelsAt(config, record, at);
    return {
      agentId,
      at,
      desires: Object.fromEntries(
        Object.entries(levels).map(([name, level]) => [
          name,
          { level, state: stateOf(config, level) },
        ]),
      ),
      drain: drainRates(config, record),
      ...(record?.effects ? { effects: record.effects } : {}),
    };
  };

  const isCharacter = (agentId: string): boolean =>
    listAgentIds(api.config).includes(agentId);

  api.registerGatewayMethod("desires.get", async ({ params, respond }) => {
    const parsed = schemas.get.safeParse(params);
    if (!parsed.success || !isCharacter(parsed.data.agentId)) {
      respond(false, undefined, {
        code: "INVALID_ARGUMENT",
        message: "agentId must name a configured character",
      });
      return;
    }
    await clock.init();
    const { agentId } = parsed.data;
    respond(true, describe(agentId, await store.lookup(agentId)), undefined);
  });

  api.registerGatewayMethod(
    "desires.configure",
    async ({ params, respond }) => {
      const parsed = schemas.configure.safeParse(params);
      if (!parsed.success || !isCharacter(parsed.data.agentId)) {
        respond(false, undefined, {
          code: "INVALID_ARGUMENT",
          message: parsed.success
            ? "agentId must name a configured character"
            : z.prettifyError(parsed.error),
        });
        return;
      }
      await clock.init();
      const { agentId, drain = {}, levels = {} } = parsed.data;
      const anchored = anchorAt(
        config,
        await store.lookup(agentId),
        clock.time(),
      );
      const nextDrain: Record<string, number> = { ...anchored.drain };
      for (const [name, rate] of Object.entries(drain)) {
        if (rate === null || rate === undefined) delete nextDrain[name];
        else nextDrain[name] = rate;
      }
      const nextLevels: Record<string, number> = { ...anchored.levels };
      for (const [name, level] of Object.entries(levels)) {
        if (level === undefined) continue;
        nextLevels[name] =
          typeof level === "number" ? level : (levelOf(config, level) ?? 0);
      }
      const record: DesireRecord = {
        ...anchored,
        levels: nextLevels,
        drain: nextDrain,
      };
      await write(agentId, record);
      respond(true, describe(agentId, record), undefined);
    },
  );

  return {
    config,
    store,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    taskExtension,
    feelings: async (agentId, at): Promise<string> => {
      return feelingsLine(
        config,
        levelsAt(config, await store.lookup(agentId), at),
      );
    },
  };
}
