import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import { resolveConfigPath } from "openclaw/plugin-sdk/state-paths";
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
  CharacterCreatePayloadSchema,
  CharacterDeletePayloadSchema,
  type CharacterCreateResponse,
  StagePayloadSchema,
  type StageResponse,
} from "@kazusa/client";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Perception } from "../perception/perception.ts";
import type { TaskStore } from "../taskman/types.ts";
import type { Messaging } from "../messaging/messaging.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import type { TaskmanService } from "../taskman/register.ts";
import { readCharacterCard, systemAgentOf, worldWikiDir } from "./card.ts";
import { characterFile } from "../wiki-layout.ts";
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
 * aliases and summary, the groups they are in, and its opening paragraph; their
 * face is the avatar picture in their workspace.
 */
/**
 * Changes the cast in `openclaw.json` as written, the way the system agent
 * does: OpenClaw's own writer refuses `agents` while an entry holds an
 * `$include` (the system agent's does), and the Gateway reloads the file
 * itself.
 */
function editCast(
  change: (entries: Record<string, Record<string, unknown>>) => void,
): void {
  const file = resolveConfigPath(process.env);
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    agents?: { entries?: Record<string, Record<string, unknown>> };
  };
  change(((config.agents ??= {}).entries ??= {}));
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temporary, file);
}

/** Every page id in the World Wiki, any folder. */
function wikiPageIds(wikiDir: string): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith(".md")) ids.add(entry.name.slice(0, -3));
  };
  walk(wikiDir);
  return ids;
}

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
    // Only groups they're in; one that has merely heard of them isn't.
    groups: [
      ...(card?.in ?? []),
      ...(card?.legacyGroups ?? []).filter(({ level }) => level !== "heard of"),
    ].map(({ ref }) => ref),
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

  route("character/create", "POST", async (req, res) => {
    const { id, name } = CharacterCreatePayloadSchema.parse(
      await readJsonBody(req),
    );
    const config = getConfig();
    const cast = listAgentIds(config);
    const wikiDir = worldWikiDir(api);
    // Characters, places and concepts share one namespace of ids.
    const taken =
      cast.includes(id) ||
      id === user.id.replace(/^user:/, "") ||
      wikiPageIds(wikiDir).has(id);
    const someone = cast.find((one) => one !== systemAgentOf(config));
    const anchorAgent = someone ?? cast[0];
    const workspaces = anchorAgent
      ? path.dirname(
          api.runtime.agent.resolveAgentWorkspaceDir(config, anchorAgent),
        )
      : path.resolve("workspaces");
    const workspace = path.join(workspaces, id);
    if (taken || existsSync(workspace)) {
      sendJson(res, 409, {
        error: `There is already a page or character called ${id}.`,
      });
      return;
    }
    const page = characterFile(wikiDir, id);
    mkdirSync(path.dirname(page), { recursive: true });
    writeFileSync(
      page,
      `---\nname: ${JSON.stringify(name)}\n---\n\n# ${name}\n`,
      { flag: "wx" },
    );
    mkdirSync(path.join(workspace, "wiki"), { recursive: true });
    writeFileSync(path.join(workspace, "MEMORY.md"), `# ${name}\n`, {
      flag: "wx",
    });
    const like = someone ? config.agents?.entries?.[someone] : undefined;
    try {
      // Offstage until someone brings them on: a new character costs nothing yet.
      await deps.setOnstage(id, false, [id]);
      editCast((entries) => {
        entries[id] = {
          // Beside the rest of the cast's, written the way theirs are.
          workspace: `${
            typeof like?.workspace === "string"
              ? path.posix.dirname(like.workspace)
              : "./workspaces"
          }/${id}`,
          // The same tools as the rest of the cast.
          ...(like?.tools ? { tools: structuredClone(like.tools) } : {}),
        };
      });
    } catch (error) {
      // Nothing half made: the page and workspace go again.
      rmSync(page, { force: true });
      rmSync(workspace, { recursive: true, force: true });
      throw error;
    }
    sendJson(res, 200, { id } satisfies CharacterCreateResponse);
  });

  route("character/delete", "POST", async (req, res) => {
    const { id } = CharacterDeletePayloadSchema.parse(await readJsonBody(req));
    const config = getConfig();
    if (!listAgentIds(config).includes(id)) {
      sendJson(res, 404, { error: `Character not found: ${id}` });
      return;
    }
    if (id === systemAgentOf(config)) {
      sendJson(res, 400, { error: "The system agent can't be deleted." });
      return;
    }
    const workspace = api.runtime.agent.resolveAgentWorkspaceDir(config, id);
    // Stopped first: nothing they were doing goes on half done.
    await deps.setOnstage(id, false, [id]);
    editCast((entries) => {
      delete entries[id];
    });
    // Gone for good: their page and their workspace.
    rmSync(characterFile(worldWikiDir(api), id), { force: true });
    rmSync(workspace, { recursive: true, force: true });
    sendJson(res, 200, { id } satisfies CharacterCreateResponse);
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
