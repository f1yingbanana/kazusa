import { currentConfig } from "../current-config.ts";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import YAML from "yaml";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { ChatFacts } from "../messaging/messaging.ts";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import {
  assembleDecisionBatch,
  type CharacterFiles,
  type DecisionContextAssembler,
} from "./decision-context.ts";
import { createSkillLoader, type SkillLoader } from "./skill-loader.ts";

/** Bound disk I/O before token selection; never follow a file symlink. */
async function readText(
  filename: string,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const file = await fs.open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!(await file.stat()).isFile()) return null;
      const buffer = Buffer.alloc(128 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      signal?.throwIfAborted();
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ELOOP")
    )
      return null;
    throw error;
  }
}

export async function readCharacterFiles(
  workspace: string,
  signal?: AbortSignal,
): Promise<CharacterFiles> {
  const [identity, soul, memory] = await Promise.all(
    ["IDENTITY.md", "SOUL.md", "MEMORY.md"].map((name) =>
      readText(path.join(workspace, name), signal),
    ),
  );
  return { identity, soul, memory };
}

const WIKI_LABELS = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  peer_id: z.string().optional(),
  last_interaction_iso: z.string().optional(),
  last_updated_iso: z.string().optional(),
});

/**
 * Sender cards first, then literal titles/aliases mentioned in the evidence.
 * Only this character's beliefs are eligible; no world-wiki lookup.
 */
export async function readPersonalWiki(
  workspace: string,
  senders: readonly string[],
  text: string,
  limit: number,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!limit) return [];
  const root = path.join(workspace, "wiki");
  try {
    if (!(await fs.lstat(root)).isDirectory()) return [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const matches: Array<{ score: number; name: string; body: string }> = [];
  const queue = [root];
  let inspected = 0;
  const query = text.toLocaleLowerCase();
  const add = async (filename: string, sender = false): Promise<void> => {
    signal?.throwIfAborted();
    const raw = await readText(filename, signal);
    if (!raw) return;
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    let labels: z.infer<typeof WIKI_LABELS> = {};
    if (frontmatter) {
      try {
        const parsed = WIKI_LABELS.safeParse(YAML.parse(frontmatter[1]));
        if (parsed.success) labels = parsed.data;
      } catch {
        /* A malformed card still has its filename and body. */
      }
    }
    const name = path.relative(root, filename);
    const aliases = [
      path.basename(filename, ".md"),
      path.basename(filename, ".md").replace(/[_-]/g, " "),
      labels.name,
      labels.title,
      labels.peer_id,
      labels.peer_id?.startsWith("user:")
        ? labels.peer_id.slice("user:".length)
        : undefined,
      ...(labels.aliases ?? []),
    ].filter((label): label is string => Boolean(label));
    const isSenderMatch =
      sender || Boolean(labels.peer_id && senders.includes(labels.peer_id));
    const score = isSenderMatch
      ? 100
      : aliases.filter((label) => {
          const phrase = label.trim();
          return (
            phrase.length >= 2 &&
            new RegExp(
              `(?:^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`,
              "iu",
            ).test(query)
          );
        }).length;
    if (!score) return;
    const body = raw.slice(frontmatter?.[0].length ?? 0);
    const impression = body.match(
      /^## Quick Impression\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
    )?.[1];
    const recordedAt = labels.last_interaction_iso ?? labels.last_updated_iso;
    matches.push({
      score,
      name,
      body: [
        `### ${name}`,
        ...(recordedAt ? [`Memory date: ${recordedAt}`] : []),
        impression ?? body,
      ].join("\n"),
    });
  };
  const senderPaths = new Set(
    senders
      .filter((id) => /^(?:user:)?[a-z0-9][a-z0-9_-]*$/.test(id))
      .map((id) => {
        const fileId = id.startsWith("user:") ? id.slice("user:".length) : id;
        return path.join(root, "entities", "characters", `${fileId}.md`);
      }),
  );
  // Exact sender lookup must not be crowded out by the general scan cap.
  try {
    if (
      (await fs.lstat(path.join(root, "entities"))).isDirectory() &&
      (await fs.lstat(path.join(root, "entities", "characters"))).isDirectory()
    ) {
      for (const filename of [...senderPaths].slice(0, 32))
        await add(filename, true);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  // Traversal skips symlinked directories as well as files.
  while (queue.length && inspected < 256) {
    signal?.throwIfAborted();
    const directory = queue.shift();
    if (!directory) break;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++inspected > 256) break;
      const filename = path.join(directory, entry.name);
      if (
        entry.isDirectory() &&
        path.relative(root, filename).split(path.sep).length < 6
      )
        queue.push(filename);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !senderPaths.has(filename)
      )
        await add(filename);
    }
  }
  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((item) => item.body);
}

export function createDecisionContextAssembler(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "time">;
    readonly skillLoader?: SkillLoader;
    /** Canonical conversation state; absent until Messaging exists. */
    readonly chatFacts?: (
      agentId: string,
      sessionKeys: readonly string[],
    ) => Promise<readonly ChatFacts[]>;
  },
): DecisionContextAssembler {
  const getConfig = () => currentConfig(api);
  const config = CONTEXT_ENGINE_CONFIG.parse(
    api.pluginConfig?.contextEngine ?? {},
  );
  const skillLoader =
    deps.skillLoader ??
    createSkillLoader({
      config: getConfig(),
      pluginRootDir: api.rootDir,
    });
  return async (agentId, request) => {
    const simTime = deps.clock.time();
    const stimuli = [...request.incomingBundle, ...request.pendingQueue];
    const keys = [
      ...new Set([
        `agent:${agentId}:tasks`,
        ...stimuli.map((item) => item.sessionKey),
      ]),
    ];
    const workspace = api.runtime.agent.resolveAgentWorkspaceDir(
      getConfig(),
      agentId,
    );
    const storePath = api.runtime.agent.session.resolveStorePath(
      getConfig().session?.store,
      { agentId },
    );
    const [streams, characterFiles, wiki, skillMarkdown, chats] =
      await Promise.all([
        Promise.all(
          keys.slice(0, 32).map(async (sessionKey) => {
            const items: SessionCatalogTranscriptItem[] = [];
            let cursor: string | undefined;
            // Catalog pages may contain non-dialogue entries. Follow up to four
            // pages, stopping at the time cutoff or configured usable-record count.
            for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
              request.signal?.throwIfAborted();
              const page = await readSessionTranscriptCatalogPage({
                agentId,
                sessionKey,
                storePath,
                pluginId: api.id,
                sourceDomain: "kazusa",
                limit: 200,
                cursor,
              }).catch((error: unknown) => {
                request.signal?.throwIfAborted();
                api.logger.warn(
                  `Decision context could not read ${sessionKey}: ${String(error)}`,
                );
                return { items: [], nextCursor: undefined };
              });
              let old = false;
              for (const item of page.items) {
                const time = Date.parse(item.timestamp ?? "");
                if (
                  time <
                  simTime - config.decisionShortTermHours * 3_600_000
                ) {
                  old = true;
                  break;
                }
                if (
                  time <= simTime &&
                  item.text?.trim() &&
                  (item.type === "userMessage" || item.type === "agentMessage")
                )
                  items.push(item);
                if (items.length >= config.decisionHistoryItems) break;
              }
              if (
                old ||
                items.length >= config.decisionHistoryItems ||
                !page.nextCursor
              )
                break;
              cursor = page.nextCursor;
            }
            return [sessionKey, items.reverse()] as const;
          }),
        ),
        readCharacterFiles(workspace, request.signal),
        readPersonalWiki(
          workspace,
          stimuli.map((item) => item.sender),
          stimuli.map((item) => item.text).join("\n"),
          config.decisionWikiMaxArticles,
          request.signal,
        ),
        skillLoader.loadSkillDocument("perception", {
          agentId,
          workspaceDir: workspace,
        }),
        deps.chatFacts?.(
          agentId,
          request.incomingBundle
            .map((item) => item.sessionKey)
            .filter((key) => key.includes(":chat:")),
        ) ?? [],
      ]);
    request.signal?.throwIfAborted();
    return assembleDecisionBatch({
      ...request,
      agentId,
      simTime,
      config,
      characterFiles,
      wiki,
      chats,
      rubric: skillMarkdown,
      sessionsContext: Object.fromEntries(streams),
    });
  };
}
