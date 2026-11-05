import { currentConfig } from "../current-config.ts";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { Clock } from "../clock/clock.ts";
import type { ChatFacts } from "../messaging/messaging.ts";
import type { MemoryService } from "../memory/register.ts";
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
    /** What comes to mind about these stimuli, one string per thing. */
    readonly recollections?: MemoryService["recollections"];
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
        ...(request.speech ? [request.speech.sessionKey] : []),
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
        Promise.resolve(
          deps.recollections?.(
            {
              agentId,
              stimulus: [
                ...stimuli.map((item) => item.text),
                ...(request.currentSpeech?.unsaid ?? []),
              ].join("\n"),
              seeds: [
                ...stimuli.map((item) => item.sender),
                ...(request.speech?.floor?.speaking ?? []),
                ...(request.speech?.floor?.turn
                  ? [request.speech.floor.turn]
                  : []),
              ],
              now: deps.clock.time(),
            },
            config.decisionWikiMaxArticles,
          ) ?? [],
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
