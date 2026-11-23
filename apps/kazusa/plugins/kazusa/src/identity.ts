import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { readCharacterCard, worldWikiDir } from "./characters/card.ts";

/**
 * The person at the keyboard, outside the world (`plugins.entries.kazusa.config
 * .user`). They talk to the system agent as themselves and play any character,
 * or none. Nobody in the world ever talks to them. Each world names them (its
 * template does): there is no default, so no setting's names leak into
 * another.
 */
const OPERATOR = z.object({
  id: z.string().regex(/^user:[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1),
  /**
   * Who they play when the world first starts (the setup guide's pick, from the
   * template's `defaultUserCharacter`); absent, nobody.
   */
  defaultCharacter: z.string().min(1).optional(),
});

export type Operator = z.infer<typeof OPERATOR>;

export function operatorOf(api: OpenClawPluginApi): Operator {
  const parsed = OPERATOR.safeParse(api.pluginConfig?.user);
  if (!parsed.success)
    throw new Error(
      'Kazusa needs `plugins.entries.kazusa.config.user`: { "id": "user:<name>", "name": "<name>" }, the person at the keyboard.',
    );
  return parsed.data;
}

/** Whether an id is a person outside the world (`user:`), not a character. */
export function isUser(id: string): boolean {
  return id.startsWith("user:");
}

/**
 * Resolve a character's display label from native identity or their World Wiki
 * page. Authorship always comes from the tool context; neither this label nor
 * file metadata can change which character is sending the message.
 */
export async function characterName(
  api: OpenClawPluginApi,
  config: OpenClawConfig,
  agentId: string,
): Promise<string> {
  const configured = api.runtime.agent
    .resolveAgentIdentity(config, agentId)
    ?.name?.trim();
  if (configured) return configured;
  return readCharacterCard(worldWikiDir(api), agentId)?.page.name ?? agentId;
}

/**
 * Anyone's name for display: a character's from their identity, the operator's
 * from plugin config. Only for the line beside their id; an unreadable identity
 * falls back to the id and never blocks it.
 */
export async function personName(
  api: OpenClawPluginApi,
  id: string,
  config: OpenClawConfig = api.config,
): Promise<string> {
  if (!isUser(id)) return await characterName(api, config, id).catch(() => id);
  const operator = operatorOf(api);
  return id === operator.id ? operator.name : id;
}
