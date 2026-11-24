import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { CLOCK_CONFIG } from "./clock/types.ts";
import { currentConfig } from "./current-config.ts";

/**
 * The system agent is the world's console, never part of it. Which agent she is
 * stays OpenClaw's own `agents.defaults.systemAgent.agentId`. What holds
 * whatever a world sets:
 *
 * - She is never played, sent offstage, deleted or counted in the cast.
 * - She has no place, task or desires: nothing in the world happens to her.
 * - Only she talks with people outside the world, and nobody in the world talks
 *   with her, so every turn of hers comes from a person: her admin tools never
 *   meet a character's words.
 *
 * What a world chooses (`plugins.entries.kazusa.config`):
 *
 * - `clock.systemAgentWhilePaused` (default on): she answers while paused.
 * - `systemAgent.is`: a character in the cast the console is. It reads as them
 *   (their page, memory, face, task and place) and keeps its own brain, tools,
 *   model and workspace. Their own turns stay theirs.
 */
export const SYSTEM_AGENT_CONFIG = z.strictObject({
  /** The id of a character in the cast the console is. */
  is: z.string().min(1).optional(),
});

/** The one field read: any spelling of the config, read-only or absent. */
interface WithSystemAgent {
  readonly agents?: {
    readonly defaults?: {
      readonly systemAgent?: { readonly agentId?: string };
    };
  };
}

/** The system agent's id, when the world has one. */
export const systemAgentOf = (
  config: WithSystemAgent | undefined,
): string | undefined => config?.agents?.defaults?.systemAgent?.agentId;

export const isSystemAgent = (
  config: WithSystemAgent | undefined,
  agentId: string | undefined,
): boolean => agentId !== undefined && agentId === systemAgentOf(config);

/** Everyone in the world: every configured agent but the system agent. */
export const worldCast = (config: OpenClawConfig): string[] =>
  [...new Set(listAgentIds(config))].filter((id) => !isSystemAgent(config, id));

export interface SystemAgent {
  /** Her id, read afresh: the config can change while running. */
  readonly id: () => string | undefined;
  readonly is: (agentId: string | undefined) => boolean;
  /** The character the console is, when that character is in the cast. */
  readonly linked: () => string | undefined;
  /** Whose page, memory, face and place an agent's turns read as. */
  readonly identityOf: (agentId: string) => string;
  /** Whether a paused clock holds her back: never, unless the world says so. */
  readonly actsWhilePaused: (agentId: string | undefined) => boolean;
}

export function systemAgent(
  api: OpenClawPluginApi,
  getConfig: () => OpenClawConfig = () => currentConfig(api),
): SystemAgent {
  const pluginConfig = api.pluginConfig as
    { systemAgent?: unknown; clock?: unknown } | undefined;
  const { is } = SYSTEM_AGENT_CONFIG.parse(pluginConfig?.systemAgent ?? {});
  const { systemAgentWhilePaused } = CLOCK_CONFIG.parse(
    pluginConfig?.clock ?? {},
  );
  const linked = (): string | undefined =>
    is && worldCast(getConfig()).includes(is) ? is : undefined;
  return {
    id: () => systemAgentOf(getConfig()),
    is: (agentId) => isSystemAgent(getConfig(), agentId),
    linked,
    identityOf: (agentId) =>
      (isSystemAgent(getConfig(), agentId) && linked()) || agentId,
    actsWhilePaused: (agentId) =>
      systemAgentWhilePaused && isSystemAgent(getConfig(), agentId),
  };
}
