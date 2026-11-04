import {
  ContextOverridesSchema,
  type ContextOverrides,
  type ContextSettings,
} from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";
import { LOCATION_CONFIG } from "../location/config.ts";
import { MEMORY_CONFIG } from "../memory/config.ts";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";

/**
 * How much a character remembers and sends each turn, sparse, for the world or
 * one character: the world's choices over the plugin config, a character's over
 * the world's. In plugin state, not `openclaw.json`, so Settings can change
 * them without OpenClaw reloading every plugin.
 */
const WORLD_KEY = "world";
const scopeKey = (agentId?: string): string =>
  agentId === undefined ? WORLD_KEY : `agent:${agentId}`;

/**
 * The settings a scope can choose, as the plugin config sets them: the context
 * engine's, memory's and location's parts of a turn.
 */
export function contextSettingsBase(
  pluginConfig: OpenClawPluginApi["pluginConfig"],
): ContextSettings {
  const config = pluginConfig ?? {};
  const context = CONTEXT_ENGINE_CONFIG.parse(config.contextEngine ?? {});
  const memory = MEMORY_CONFIG.parse(config.memory ?? {});
  const location = LOCATION_CONFIG.parse(config.location ?? {});
  return {
    shortTermHours: context.shortTermHours,
    ledgerMaxTokens: context.ledgerMaxTokens,
    maxContextTokens: context.maxContextTokens,
    ledgerGridHours: context.ledgerGridHours,
    ledgerTrimTo: context.ledgerTrimTo,
    toolHistoryTokens: context.toolHistoryMaxTokens,
    onYourMindTokens: memory.maxTokens,
    peopleLimit: memory.rosterLimit,
    placesLimit: location.listLimit,
  };
}

interface ResolvedContextSettings {
  /** What the scope inherits: the world's for a character. */
  readonly inherited: ContextSettings;
  readonly overrides: ContextOverrides;
  /** What its turns use. */
  readonly effective: ContextSettings;
}

interface ContextSettingsStore {
  readonly resolve: (
    base: ContextSettings,
    agentId?: string,
  ) => Promise<ResolvedContextSettings>;
  /** Replaces the scope's overrides; an absent field inherits again. */
  readonly save: (
    overrides: ContextOverrides,
    agentId?: string,
  ) => Promise<ContextOverrides>;
}

/** Only what was chosen: a field set to `undefined` is no choice. */
const chosen = (overrides: ContextOverrides): ContextOverrides =>
  Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );

function createContextSettings(
  store: StateStore<ContextOverrides>,
): ContextSettingsStore {
  // A record that no longer parses (an older shape) is ignored, not trusted.
  const own = async (agentId?: string): Promise<ContextOverrides> => {
    const parsed = ContextOverridesSchema.safeParse(
      await store.lookup(scopeKey(agentId)),
    );
    return parsed.success ? chosen(parsed.data) : {};
  };
  return {
    resolve: async (base, agentId) => {
      const world = { ...base, ...(await own()) };
      if (agentId === undefined)
        return { inherited: base, overrides: await own(), effective: world };
      const overrides = await own(agentId);
      return {
        inherited: world,
        overrides,
        effective: { ...world, ...overrides },
      };
    },
    save: async (overrides, agentId) => {
      const next = chosen(ContextOverridesSchema.parse(overrides));
      await store.register(scopeKey(agentId), next);
      return next;
    },
  };
}

/** The one retained store, from any module. Never read it during registration. */
export function contextSettings(api: OpenClawPluginApi): ContextSettingsStore {
  return createContextSettings(
    api.runtime.state.openKeyedStore<ContextOverrides>({
      namespace: "contextSettings",
      retention: "retained",
    }),
  );
}
