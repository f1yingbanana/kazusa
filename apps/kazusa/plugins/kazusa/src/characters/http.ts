import { readFile } from "node:fs/promises";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  type CharacterDetail,
  type CharacterDetailResponse,
  type CharacterStatus,
  type CharacterSummary,
  type CharactersResponse,
} from "@kazusa/client";
import { z } from "zod";
import type { Perception } from "../perception/perception.ts";
import type { TaskStore } from "../taskman/types.ts";
import type { Messaging } from "../messaging/messaging.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import type { TaskmanService } from "../taskman/register.ts";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";

const USER = z.object({
  id: z
    .string()
    .regex(/^user:[a-z0-9][a-z0-9_-]*$/)
    .default("user:sensei"),
  name: z.string().trim().min(1).default("Sensei"),
});

const IDENTITY_FRONTMATTER = z
  .object({
    agent_id: z.string().optional(),
    character_id: z.string().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    handle: z.string().optional(),
    school: z.string().optional(),
    club: z.string().optional(),
    occupation: z.string().optional(),
    avatarUrl: z.string().optional(),
    avatar: z.string().optional(),
    role: z.string().optional(),
    combat_role: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    personality_traits: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .passthrough();

export async function loadCharacterData(
  api: OpenClawPluginApi,
  agentId: string,
): Promise<{
  name: string;
  avatarUrl?: string;
  occupation?: string;
  affiliation?: string;
  aliases: string[];
  role?: string;
  personalityTraits: string[];
  bodyMarkdown: string;
}> {
  let name = agentId;
  let avatarUrl: string | undefined;
  let occupation: string | undefined;
  let affiliation: string | undefined;
  const aliasSet = new Set<string>();
  let role: string | undefined;
  const traitsSet = new Set<string>();
  let bodyMarkdown = "";

  // 1. Check configured agent identity in OpenClaw
  const configured = api.runtime.agent.resolveAgentIdentity(
    api.config,
    agentId,
  );
  if (configured?.name?.trim()) name = configured.name.trim();

  // 2. Read IDENTITY.md from agent workspace
  try {
    const workspace = api.runtime.agent.resolveAgentWorkspaceDir(
      api.config,
      agentId,
    );
    const text = await readFile(path.join(workspace, "IDENTITY.md"), "utf8");
    const { data, body } = readFrontmatter(text, IDENTITY_FRONTMATTER);
    if (data.name?.trim()) name = data.name.trim();
    if (data.avatarUrl?.trim()) avatarUrl = data.avatarUrl.trim();
    if (data.occupation?.trim()) occupation = data.occupation.trim();
    else if (data.club?.trim()) occupation = data.club.trim();

    if (data.school?.trim()) affiliation = data.school.trim();
    else if (data.club?.trim()) affiliation = data.club.trim();

    if (data.handle?.trim()) aliasSet.add(data.handle.trim());
    if (Array.isArray(data.aliases)) {
      for (const a of data.aliases) if (a.trim()) aliasSet.add(a.trim());
    }
    if (data.role?.trim()) role = data.role.trim();
    else if (data.combat_role?.trim()) role = data.combat_role.trim();

    if (Array.isArray(data.personality_traits)) {
      for (const t of data.personality_traits)
        if (t.trim()) traitsSet.add(t.trim());
    } else if (typeof data.personality_traits === "string") {
      for (const t of data.personality_traits.split(","))
        if (t.trim()) traitsSet.add(t.trim());
    }
    if (body) bodyMarkdown = body;
  } catch {
    // Non-fatal if IDENTITY.md is missing or unreadable
  }

  // 3. Fallback / augment with World Wiki card if present
  try {
    const cwd = process.cwd();
    const possiblePaths = [
      path.join(cwd, "shared/wiki/entities/characters", `${agentId}.md`),
      path.join(
        cwd,
        "apps/kazusa/shared/wiki/entities/characters",
        `${agentId}.md`,
      ),
    ];
    for (const wikiPath of possiblePaths) {
      try {
        const text = await readFile(wikiPath, "utf8");
        const { data, body } = readFrontmatter(text, IDENTITY_FRONTMATTER);
        if (!occupation && data.occupation) occupation = data.occupation;
        if (!affiliation && (data.school || data.club))
          affiliation = data.school ?? data.club;
        if (!role && (data.role || data.combat_role))
          role = data.role ?? data.combat_role;
        if (!avatarUrl && (data.avatarUrl || data.avatar))
          avatarUrl = data.avatarUrl ?? data.avatar;
        if (body && !bodyMarkdown) bodyMarkdown = body;
        break;
      } catch {
        // Continue searching
      }
    }
  } catch {
    // Non-fatal
  }

  return {
    name,
    avatarUrl,
    occupation,
    affiliation,
    aliases: [...aliasSet],
    role,
    personalityTraits: [...traitsSet],
    bodyMarkdown,
  };
}

export async function resolveCharacterStatus(
  agentId: string,
  deps: {
    readonly taskStore: TaskStore;
    readonly perception: Perception;
    readonly messaging: Messaging;
  },
): Promise<CharacterStatus> {
  const [task, brainState] = await Promise.all([
    deps.taskStore.lookup(agentId),
    deps.perception.getBrainState(agentId),
  ]);
  const composingIn = deps.messaging.getComposingChats(agentId);

  return {
    task: task
      ? {
          id: task.id,
          type: task.type,
          description: task.description,
          startedAt: new Date(task.startedAt).getTime(),
          endAt: new Date(task.endAt).getTime(),
        }
      : undefined,
    brain: brainState.brain,
    composingIn,
    queued: brainState.queued,
  };
}

export function registerCharactersHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly taskman: TaskmanService;
    readonly perception: Perception;
    readonly messaging: Messaging;
    readonly broadcaster: KazusaRealtimeBroadcaster;
  },
): void {
  const user = USER.parse(api.pluginConfig?.user ?? {});
  const route = createRouteRegistrar(api);
  const statusDeps = {
    taskStore: deps.taskman.store,
    perception: deps.perception,
    messaging: deps.messaging,
  };

  const broadcastStatus = async (agentId: string): Promise<void> => {
    try {
      const status = await resolveCharacterStatus(agentId, statusDeps);
      deps.broadcaster.broadcast({
        type: "status",
        characterId: agentId,
        status,
      });
    } catch {
      // Broadcast error must not crash background tasks
    }
  };

  // Wire automatic status pushes when brain or task state changes
  deps.perception.onBrainStateChange((agentId) => {
    void broadcastStatus(agentId);
  });
  deps.taskman.onTaskChange((agentId) => {
    void broadcastStatus(agentId);
  });
  deps.messaging.onEvent((event) => {
    if (event.type === "typing") {
      void broadcastStatus(event.typing.senderId);
    }
  });

  route("characters", "GET", async (_req, res) => {
    const agentIds = [...new Set(listAgentIds(api.config))];
    const characters: CharacterSummary[] = await Promise.all(
      agentIds.map(async (id) => {
        const data = await loadCharacterData(api, id);
        const status = await resolveCharacterStatus(id, statusDeps);
        return {
          id,
          name: data.name,
          kind: "agent",
          avatarUrl: data.avatarUrl,
          occupation: data.occupation,
          affiliation: data.affiliation,
          aliases: data.aliases,
          status,
        };
      }),
    );

    // Append Player summary
    characters.push({
      id: user.id,
      name: user.name,
      kind: "player",
      aliases: [],
    });

    sendJson(res, 200, { characters } satisfies CharactersResponse);
  });

  route("character", "GET", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) {
      sendJson(res, 400, { error: "Missing required id query parameter." });
      return;
    }

    if (id === user.id) {
      sendJson(res, 200, {
        character: {
          id: user.id,
          name: user.name,
          kind: "player",
          aliases: [],
          personalityTraits: [],
          bodyMarkdown: "The Player / Sensei in Kivotos.",
        },
      } satisfies CharacterDetailResponse);
      return;
    }

    const agentIds = new Set(listAgentIds(api.config));
    if (!agentIds.has(id)) {
      sendJson(res, 404, { error: `Character not found: ${id}` });
      return;
    }

    const data = await loadCharacterData(api, id);
    const status = await resolveCharacterStatus(id, statusDeps);
    const character: CharacterDetail = {
      id,
      name: data.name,
      kind: "agent",
      avatarUrl: data.avatarUrl,
      occupation: data.occupation,
      affiliation: data.affiliation,
      aliases: data.aliases,
      status,
      role: data.role,
      personalityTraits: data.personalityTraits,
      bodyMarkdown: data.bodyMarkdown,
    };

    sendJson(res, 200, { character } satisfies CharacterDetailResponse);
  });
}
