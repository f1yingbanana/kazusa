import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { readCharacterCard, worldWikiDir } from "./characters/card.ts";

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
 * Anyone's name for display: a character's from their identity, the player's
 * from plugin config. Only for the line beside their id; an unreadable identity
 * falls back to the id and never blocks it.
 */
export async function personName(
  api: OpenClawPluginApi,
  id: string,
  config: OpenClawConfig = api.config,
): Promise<string> {
  if (!id.startsWith("user:"))
    return await characterName(api, config, id).catch(() => id);
  const user = api.pluginConfig?.user as
    { readonly id?: string; readonly name?: string } | undefined;
  return id === (user?.id ?? "user:sensei") ? (user?.name ?? "Sensei") : id;
}
