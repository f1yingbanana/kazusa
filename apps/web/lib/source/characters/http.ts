import {
  AgentsResponseSchema,
  type Agent,
  type CharacterSummary,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

/**
 * Interim adapter over the existing `GET /kazusa/agents` (id, name, avatar).
 * Replace with `GET /kazusa/characters` once the plugin serves it; the rest of
 * the app already consumes `CharacterSummary`.
 */
export function agentToCharacter(agent: Agent): CharacterSummary {
  return {
    id: agent.id,
    name: agent.name,
    kind: "agent",
    avatarUrl: agent.avatarUrl,
    aliases: [],
  };
}

export async function fetchCharacters(
  baseUrl: string,
  token?: string,
): Promise<CharacterSummary[]> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/agents"),
    undefined,
    token,
  );
  return AgentsResponseSchema.parse(data).agents.map(agentToCharacter);
}
