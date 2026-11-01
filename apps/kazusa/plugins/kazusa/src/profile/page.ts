import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { LOCATION_CONFIG } from "../location/config.ts";
import { readFrontmatter } from "../markdown/frontmatter.ts";

const PAGE = z.looseObject({ character_id: z.string().optional() });
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const TITLE = /^# .*(?:\r?\n)*/;

/**
 * The World Wiki root, which holds the player's page. Location owns it because
 * it reads each person's `home` from the same pages.
 */
export const playerWikiDir = (api: OpenClawPluginApi): string =>
  LOCATION_CONFIG.parse(api.pluginConfig?.location ?? {}).wikiDir;

const charactersDir = (wikiDir: string): string =>
  path.join(wikiDir, "entities", "characters");

const namedFile = (wikiDir: string, id: string): string =>
  path.join(charactersDir(wikiDir), `${id.replace(/^user:/, "")}.md`);

export interface PlayerPage {
  readonly file: string;
  readonly text: string;
  /** The page's body under its title. */
  readonly about: string;
}

async function parsePage(
  file: string,
): Promise<PlayerPage & { owner?: string }> {
  const text = await readFile(file, "utf8");
  const { data, body } = readFrontmatter(text, PAGE);
  return {
    file,
    text,
    owner: data.character_id,
    about: body.replace(TITLE, "").trim(),
  };
}

/** The player's World Wiki page: named after their id, or claiming it. */
export async function readPlayerPage(
  wikiDir: string,
  id: string,
): Promise<PlayerPage | undefined> {
  const dir = charactersDir(wikiDir);
  if (!existsSync(dir)) return undefined;
  const named = namedFile(wikiDir, id);
  if (existsSync(named)) {
    const page = await parsePage(named);
    if (page.owner === undefined || page.owner === id) return page;
  }
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".md")) continue;
    const page = await parsePage(path.join(dir, file));
    if (page.owner === id) return page;
  }
  return undefined;
}

/**
 * Replaces the body under the title; the front matter and title stay as
 * written.
 */
export function renderPlayerPage(
  text: string | undefined,
  player: { readonly id: string; readonly name: string },
  about: string,
): string {
  const frontmatter =
    text?.match(FRONTMATTER)?.[0].trimEnd() ??
    `---\ncharacter_id: ${player.id}\nname: ${JSON.stringify(player.name)}\nis_simulated_agent: false\n---`;
  const rest = (text ?? "").replace(FRONTMATTER, "").trimStart();
  const title = rest.match(TITLE)?.[0].trimEnd() ?? `# ${player.name}`;
  const body = about.trim();
  return `${frontmatter}\n\n${title}\n${body ? `\n${body}\n` : ""}`;
}

/** Writes the description to the player's page, starting one if they have none. */
export async function writePlayerAbout(
  wikiDir: string,
  player: { readonly id: string; readonly name: string },
  about: string,
): Promise<void> {
  const page = await readPlayerPage(wikiDir, player.id);
  const file = page?.file ?? namedFile(wikiDir, player.id);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.tmp`,
  );
  await writeFile(temporary, renderPlayerPage(page?.text, player, about));
  await rename(temporary, file);
}
