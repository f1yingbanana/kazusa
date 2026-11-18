import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import { MEMORY_CONFIG } from "../memory/config.ts";
import { parsePage, type Page } from "../memory/page.ts";
import { sharedDir } from "../shared-dir.ts";

/*
 * A character's one card is their page in the World Wiki
 * (`entities/characters/<id>.md`): who they are, in layers others see as well
 * as they know them, and all of it for the character themselves. It takes the
 * place of `IDENTITY.md` and `SOUL.md`, which a world character's turns no
 * longer read, so the page the user edits is the one the character lives by.
 */

/** Where pages live that make up a character's card. */
export const CHARACTER_PAGES = path.join("entities", "characters");

/** The World Wiki's folder, as memory reads it. */
export function worldWikiDir(api: OpenClawPluginApi): string {
  const config = MEMORY_CONFIG.parse(
    (api.pluginConfig as { memory?: unknown } | undefined)?.memory ?? {},
  );
  return config.wikiDir ?? sharedDir("wiki");
}

export const characterPagePath = (wikiDir: string, id: string): string =>
  path.join(wikiDir, CHARACTER_PAGES, `${id}.md`);

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
    page: parsePage(text, path.join(CHARACTER_PAGES, `${id}.md`)),
  };
}

/** The system agent keeps her own workspace files: she isn't in the world. */
export const systemAgentOf = (config: OpenClawConfig): string | undefined =>
  config.agents?.defaults?.systemAgent?.agentId;

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
      if (agentId === systemAgentOf(currentConfig(api))) return;
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
        "A world character's turns read their World Wiki page in place of IDENTITY.md and SOUL.md.",
    },
  );
}
