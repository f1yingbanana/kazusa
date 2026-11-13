import { readFileSync } from "node:fs";
import path from "node:path";
import {
  authorName,
  WorldPackageSchema,
  type WorldMeta,
  type WorldPackage,
} from "@kazusa/client";

/** The world's own manifest, beside its `shared/` and `workspaces/`. */
export const WORLD_PACKAGE = "package.json";

/**
 * The `package.json` in `dir`, parsed; `undefined` when there is none or it
 * doesn't parse. A world made before worlds had one gets it from `npm run dev`
 * (`scripts/world-package.mjs`) before the Gateway starts.
 */
export function readWorldPackage(dir: string): WorldPackage | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(dir, WORLD_PACKAGE), "utf8");
  } catch {
    return undefined;
  }
  try {
    return WorldPackageSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

/**
 * Who to credit for the world in `dir`, as the client shows it: the name people
 * read, the version, the author's name and the homepage.
 */
export function worldCredit(dir: string): WorldMeta["package"] {
  const world = readWorldPackage(dir);
  if (!world) return undefined;
  const author = authorName(world.author);
  return {
    name: world.displayName ?? world.name,
    ...(world.version ? { version: world.version } : {}),
    ...(author ? { author } : {}),
    ...(world.homepage ? { homepage: world.homepage } : {}),
  };
}

/** Where a live world's template is downloaded: `worlds/<id>` beside it. */
export function templateDir(live: string, id: string): string {
  return path.resolve(live, "..", "worlds", id);
}

/**
 * Orders two versions by their numbers (`0.10.0` after `0.9.2`): positive when
 * `a` is newer. Anything after the numbers (`-beta`, `+build`) is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    (/^v?(\d+(?:\.\d+)*)/.exec(version.trim())?.[1] ?? "0")
      .split(".")
      .map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The newer version of this world's template, when its clone has one: Kazusa
 * fetches the clone on every start, and `world_update` brings it in. Read on
 * each request; two small files.
 */
export function availableUpdate(live: string): WorldMeta["update"] {
  const world = readWorldPackage(live);
  const id = world?.kazusa.template;
  if (!world || !id) return undefined;
  const version = readWorldPackage(templateDir(live, id))?.version;
  if (!version || compareVersions(version, world.version ?? "0") <= 0)
    return undefined;
  return {
    version,
    ...(world.version ? { current: world.version } : {}),
    systemAgent: world.kazusa.systemAgent,
  };
}
