import { readFileSync } from "node:fs";
import path from "node:path";
import { characterFile } from "../wiki-layout.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import { MEMORY_CONFIG } from "../memory/config.ts";
import { parsePage, type Page } from "../memory/page.ts";
import { sharedDir } from "../shared-dir.ts";
import { systemAgent } from "../system-agent.ts";

/*
 * A character's one card is their page in the World Wiki
 * (`entities/characters/<id>.md`): who they are, in layers others see as well
 * as they know them, and all of it for the character themselves. It takes the
 * place of `IDENTITY.md` and `SOUL.md`, which a world character's turns no
 * longer read, so the page the user edits is the one the character lives by.
 */

/** Where pages live that make up a character's card. */

/** The World Wiki's folder, as memory reads it. */
export function worldWikiDir(api: OpenClawPluginApi): string {
  const config = MEMORY_CONFIG.parse(
    (api.pluginConfig as { memory?: unknown } | undefined)?.memory ?? {},
  );
  return config.wikiDir ?? sharedDir("wiki");
}

export const characterPagePath = (wikiDir: string, id: string): string =>
  characterFile(wikiDir, id);

export interface CharacterCard {
  /** The page as written, for the character's own turns. */
  readonly text: string;
  readonly page: Page;
}

/** Their card, or nothing while the World Wiki has no page for them. */
export function readCharacterCard(
  wikiDir: string,
  id: string,
): CharacterCard | undefined {
  let text: string;
  try {
    text = readFileSync(characterPagePath(wikiDir, id), "utf8");
  } catch {
    return undefined;
  }
  return {
    text,
    page: parsePage(
      text,
      path.relative(wikiDir, characterPagePath(wikiDir, id)),
    ),
  };
}

/** Files OpenClaw adds to a turn that a world character's card replaces. */
const REPLACED = new Set(["IDENTITY.md", "SOUL.md"]);

interface BootstrapFile {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
}

/**
 * A world character's turns read their World Wiki page where OpenClaw would add
 * `IDENTITY.md` and `SOUL.md`: whole, at the stable start of every turn, read
 * afresh so an edit counts from the next turn. `MEMORY.md` stays.
 */
export function registerCharacterCard(api: OpenClawPluginApi): void {
  const wikiDir = worldWikiDir(api);
  const system = systemAgent(api);
  /**
   * The console linked to a character reads as them: their World Wiki page
   * where its own IDENTITY.md was, and their MEMORY.md, read only (their nights
   * write it). Its other files, the admin instructions, stay its own.
   */
  const asLinked = (
    files: readonly BootstrapFile[],
    linked: string,
    workspaceDir: string,
  ): BootstrapFile[] => {
    const card = readCharacterCard(wikiDir, linked);
    const memoryPath = path.join(
      api.runtime.agent.resolveAgentWorkspaceDir(currentConfig(api), linked),
      "MEMORY.md",
    );
    let memory: string | undefined;
    try {
      memory = readFileSync(memoryPath, "utf8");
    } catch {
      memory = undefined;
    }
    const kept = files.filter(
      (file) => file.name !== "IDENTITY.md" && file.name !== "MEMORY.md",
    );
    return [
      ...(card
        ? [
            {
              name: "IDENTITY.md",
              path: path.join(workspaceDir, "IDENTITY.md"),
              content: card.text,
              missing: false,
            },
          ]
        : []),
      ...kept,
      ...(memory === undefined
        ? []
        : [
            {
              name: "MEMORY.md",
              path: path.join(workspaceDir, "MEMORY.md"),
              content: memory,
              missing: false,
            },
          ]),
    ];
  };
  api.registerHook(
    "agent:bootstrap",
    (event) => {
      const context = event.context as {
        bootstrapFiles?: BootstrapFile[];
        workspaceDir?: string;
        agentId?: string;
      };
      const agentId = context.agentId;
      const files = context.bootstrapFiles;
      if (!agentId || !files || !context.workspaceDir) return;
      if (system.is(agentId)) {
        const linked = system.linked();
        if (linked)
          context.bootstrapFiles = asLinked(
            files,
            linked,
            context.workspaceDir,
          );
        return;
      }
      // A world not yet updated to one page per character still has its
      // cards: they stay its character's, as they were.
      if (files.some((file) => REPLACED.has(file.name) && !file.missing))
        return;
      const kept = files.filter((file) => !REPLACED.has(file.name));
      const card = readCharacterCard(wikiDir, agentId);
      if (card)
        kept.unshift({
          name: "IDENTITY.md",
          path: path.join(context.workspaceDir, "IDENTITY.md"),
          content: card.text,
          missing: false,
        });
      context.bootstrapFiles = kept;
    },
    {
      name: "kazusa-character-card",
      description:
        "A world character's turns read their World Wiki page in place of IDENTITY.md and SOUL.md, once those are gone.",
    },
  );
}
