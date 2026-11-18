import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  type CharacterDetail,
  type CharacterDetailResponse,
  type CharacterStatus,
  type CharacterSummary,
  type CharactersResponse,
  StagePayloadSchema,
  type StageResponse,
} from "@kazusa/client";
import { z } from "zod";
import type { Perception } from "../perception/perception.ts";
import type { TaskStore } from "../taskman/types.ts";
import type { Messaging } from "../messaging/messaging.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import type { TaskmanService } from "../taskman/register.ts";
import { readCharacterCard, worldWikiDir } from "./card.ts";
import { localAvatarUrl, registerAvatarHttp } from "./avatar.ts";
import { defaultPortraitUrl } from "../scene/portraits.ts";
import type { Stage } from "../stage/stage.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { playerWikiDir, readPlayerPage } from "../profile/page.ts";

const USER = z.object({
  id: z
    .string()
    .regex(/^user:[a-z0-9][a-z0-9_-]*$/)
    .default("user:sensei"),
  name: z.string().trim().min(1).default("Sensei"),
});

/**
 * What the roster shows of a character, from their World Wiki page: its name,
 * aliases and summary, the groups it puts them in, and its opening paragraph;
 * their face is the avatar picture in their workspace.
 */
export async function loadCharacterData(
  api: OpenClawPluginApi,
  agentId: string,
  config: OpenClawConfig = api.config,
): Promise<{
  name: string;
  avatarUrl?: string;
  portraitUrl?: string;
  summary?: string;
  groups: string[];
  aliases: string[];
  lead: string;
}> {
  const card = readCharacterCard(worldWikiDir(api), agentId)?.page;
  const configured = api.runtime.agent
    .resolveAgentIdentity(config, agentId)
    ?.name?.trim();
  const avatarUrl = await localAvatarUrl(api, agentId, config);
  const portraitUrl = defaultPortraitUrl(
    agentId,
    api.runtime.agent.resolveAgentWorkspaceDir(config, agentId),
  );
  return {
    name: configured || card?.name || agentId,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(portraitUrl === undefined ? {} : { portraitUrl }),
    ...(card?.summary ? { summary: card.summary } : {}),
    groups: card?.groups.map(({ ref }) => ref) ?? [],
    aliases: [...(card?.aliases ?? [])],
    lead: card?.lead ?? "",
  };
}

export async function resolveCharacterStatus(
  agentId: string,
  deps: {
    readonly taskStore: TaskStore;
    readonly perception: Perception;
    readonly messaging: Messaging;
    readonly stage: Pick<Stage, "isOnstage" | "lookup">;
  },
): Promise<CharacterStatus> {
  const [task, brainState, onstage, stageRecord] = await Promise.all([
    deps.taskStore.lookup(agentId),
    deps.perception.getBrainState(agentId),
    deps.stage.isOnstage(agentId),
    deps.stage.lookup(agentId),
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
    onstage,
    ...(!onstage && stageRecord ? { offstageSince: stageRecord.since } : {}),
    ...(brainState.failure
      ? {
          failure: {
            error: brainState.failure.error,
            at: brainState.failure.at,
          },
        }
      : {}),
  };
}

export function registerCharactersHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly taskman: TaskmanService;
    readonly perception: Perception;
    readonly messaging: Messaging;
    readonly broadcaster: KazusaRealtimeBroadcaster;
    readonly stage: Pick<Stage, "isOnstage" | "lookup">;
    /** Sends a character off or brings them back, with every effect. */
    readonly setOnstage: (
      id: string,
      onstage: boolean,
      together: readonly string[],
    ) => Promise<void>;
  },
): void {
  const getConfig = () => currentConfig(api);
  const user = USER.parse(api.pluginConfig?.user ?? {});
  const route = createRouteRegistrar(api);
  registerAvatarHttp(api, route);
  const statusDeps = {
    taskStore: deps.taskman.store,
    perception: deps.perception,
    messaging: deps.messaging,
    stage: deps.stage,
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
    const config = getConfig();
    const agentIds = [...new Set(listAgentIds(config))];
    const characters: CharacterSummary[] = await Promise.all(
      agentIds.map(async (id) => {
        const data = await loadCharacterData(api, id, config);
        const status = await resolveCharacterStatus(id, statusDeps);
        return {
          id,
          name: data.name,
          kind: "agent",
          isSystemAgent: id === config.agents?.defaults?.systemAgent?.agentId,
          avatarUrl: data.avatarUrl,
          portraitUrl: data.portraitUrl,
          ...(data.summary ? { summary: data.summary } : {}),
          groups: data.groups,
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

  route("character/stage", "POST", async (req, res) => {
    const { ids, onstage } = StagePayloadSchema.parse(await readJsonBody(req));
    const roster = new Set(listAgentIds(getConfig()));
    const unknown = ids.filter((id) => !roster.has(id));
    if (unknown.length) {
      sendJson(res, 404, {
        error: `Character not found: ${unknown.join(", ")}`,
      });
      return;
    }
    // One at a time: each change moves people and conversations others see.
    const group = [...new Set(ids)];
    const statuses: Record<string, CharacterStatus> = {};
    for (const id of group) {
      await deps.setOnstage(id, onstage, group);
      const status = await resolveCharacterStatus(id, statusDeps);
      deps.broadcaster.broadcast({ type: "status", characterId: id, status });
      statuses[id] = status;
    }
    sendJson(res, 200, { statuses } satisfies StageResponse);
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
          groups: [],
          bodyMarkdown:
            (await readPlayerPage(playerWikiDir(api), user.id))?.about ||
            `The player, ${user.name}.`,
        },
      } satisfies CharacterDetailResponse);
      return;
    }

    const config = getConfig();
    const agentIds = new Set(listAgentIds(config));
    if (!agentIds.has(id)) {
      sendJson(res, 404, { error: `Character not found: ${id}` });
      return;
    }

    const data = await loadCharacterData(api, id, config);
    const status = await resolveCharacterStatus(id, statusDeps);
    const character: CharacterDetail = {
      id,
      name: data.name,
      kind: "agent",
      isSystemAgent: id === config.agents?.defaults?.systemAgent?.agentId,
      avatarUrl: data.avatarUrl,
      portraitUrl: data.portraitUrl,
      ...(data.summary ? { summary: data.summary } : {}),
      groups: data.groups,
      aliases: data.aliases,
      status,
      bodyMarkdown: data.lead,
    };

    sendJson(res, 200, { character } satisfies CharacterDetailResponse);
  });
}
