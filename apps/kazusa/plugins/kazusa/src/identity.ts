import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import YAML from "yaml";
import { z } from "zod";
import { AGENT_ID } from "./messaging/conversations.ts";

const IDENTITY = z.object({
  agent_id: AGENT_ID.optional(),
  name: z.string().trim().min(1),
});

/**
 * Resolve a character's display label from native identity or its own
 * workspace. Authorship always comes from the tool context; neither this label
 * nor file metadata can change which character is sending the message.
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
  const workspace = api.runtime.agent.resolveAgentWorkspaceDir(config, agentId);
  try {
    const text = await readFile(path.join(workspace, "IDENTITY.md"), "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return agentId;
    const identity = IDENTITY.parse(YAML.parse(frontmatter[1]));
    if (identity.agent_id && identity.agent_id !== agentId)
      throw new Error("Character identity does not match the sending agent.");
    return identity.name;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return agentId;
    throw error;
  }
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
