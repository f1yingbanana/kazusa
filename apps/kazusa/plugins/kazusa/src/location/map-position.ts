import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlacePositions } from "@kazusa/client";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import { PLACE_FRONTMATTER } from "./map.ts";

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Sets `map` on a place page by replacing only those lines. Re-serializing the
 * YAML would reformat what a person or a world's author wrote, and this runs on
 * pages they also edit. An existing `plane` stays.
 */
export function withPosition(
  text: string,
  position: { readonly x: number; readonly y: number },
): string {
  const opening = OPENING.exec(text);
  if (!opening) throw new Error("This page has no frontmatter.");
  const { data } = readFrontmatter(text, PLACE_FRONTMATTER);
  const plane = data.map?.plane;
  const planePart =
    plane === undefined
      ? ""
      : `plane: ${/^[a-z0-9_-]+$/u.test(plane) ? plane : JSON.stringify(plane)}, `;
  const line = `map: { ${planePart}x: ${position.x}, y: ${position.y} }`;
  const newline = opening[0].includes("\r\n") ? "\r\n" : "\n";
  const lines = opening[1].split(/\r?\n/u);
  const start = lines.findIndex((entry) => /^map:(\s|$)/u.test(entry));
  if (start === -1) {
    lines.push(line);
  } else {
    // A block-style value continues on the indented lines below its key.
    let end = start + 1;
    while (end < lines.length && /^\s+\S/u.test(lines[end])) end += 1;
    lines.splice(start, end - start, line);
  }
  return `---${newline}${lines.join(newline)}${newline}---${newline}${text.slice(opening[0].length)}`;
}

/**
 * Writes positions to the place pages they belong to, each atomically. Pages
 * are found by `place_id`, as the map finds them. A place removed in the
 * meantime is skipped: there's nothing left to draw. A crash partway leaves a
 * partly applied picture and no broken page.
 */
export async function writePositions(
  wikiDir: string,
  positions: PlacePositions["positions"],
): Promise<number> {
  const dir = path.join(wikiDir, "entities", "places");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  let written = 0;
  for (const file of files) {
    const target = path.join(dir, file);
    const text = await readFile(target, "utf8");
    const { data } = readFrontmatter(text, PLACE_FRONTMATTER);
    const position = positions[data.place_id];
    if (!position) continue;
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, withPosition(text, position));
    await rename(temporary, target);
    written += 1;
  }
  return written;
}
