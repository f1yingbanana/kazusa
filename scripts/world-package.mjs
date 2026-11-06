#!/usr/bin/env node
/**
 * Worlds describe themselves in an npm-style `package.json` (name, version,
 * author, homepage, and Kazusa's own settings under `kazusa`). A world made
 * before that has a `world.json` instead, or nothing that says where it came
 * from. This gives it its template's `package.json`, marked with the template
 * it came from, so credits show and updates can tell its version. It runs
 * before the Gateway starts, which reads the file: from `scripts/dev.mjs`
 * (installed copies run it too) and from `npm run gateway`.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Which template a live world came from: the id its `world.json` recorded, or
 * else the one template whose player id it has. The player's id is set when a
 * world is made and never changes, and each template has its own.
 */
export function templateOf(root) {
  const app = path.join(root, "apps/kazusa");
  const legacy = path.join(app, "world/world.json");
  const recorded = existsSync(legacy) ? readJson(legacy).id : undefined;
  if (
    recorded &&
    existsSync(path.join(app, "worlds", recorded, "package.json"))
  )
    return recorded;
  const configFile = path.join(app, "world/openclaw.json");
  if (!existsSync(configFile)) return undefined;
  const player =
    readJson(configFile).plugins?.entries?.kazusa?.config?.user?.id;
  if (!player) return undefined;
  const matches = readdirSync(path.join(app, "worlds"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => {
      const file = path.join(app, "worlds", id, "package.json");
      return (
        existsSync(file) && readJson(file).kazusa?.config?.user?.id === player
      );
    });
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Writes the live world's `package.json` from its template's when it has none
 * that says which template it is, and retires its `world.json`. Leaves alone a
 * world whose template it can't tell. Returns what it did, to report.
 */
export function adoptWorldPackage(root) {
  const live = path.join(root, "apps/kazusa/world");
  const file = path.join(live, "package.json");
  const legacy = path.join(live, "world.json");
  // Not only finished worlds: one imported but not yet set up needs it too,
  // since setup reads the template it came from in package.json.
  if (!existsSync(live)) return [];
  const current = existsSync(file) ? readJson(file) : undefined;
  if (current?.kazusa?.template) {
    // Already adopted; a world.json left beside it says nothing more.
    if (existsSync(legacy)) rmSync(legacy);
    return [];
  }
  const id = templateOf(root);
  if (!id) return [];
  const template = readJson(
    path.join(root, "apps/kazusa/worlds", id, "package.json"),
  );
  const world = { ...template, kazusa: { ...template.kazusa, template: id } };
  writeFileSync(file, `${JSON.stringify(world, null, 2)}\n`);
  if (existsSync(legacy)) rmSync(legacy);
  return [
    `This world now has a package.json: ${world.displayName ?? world.name} ${world.version ?? ""}`.trim() +
      ".",
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of adoptWorldPackage(root)) console.log(line);
}
