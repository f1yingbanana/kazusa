import { readFileSync } from "node:fs";
import path from "node:path";
import {
  authorName,
  WorldPackageSchema,
  type WorldMeta,
  type WorldPackage,
} from "@kazusa/client";
import { downloadedRelease, gitIn } from "../world-update/git.ts";

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

/**
 * The release downloaded (Settings → Updates → World) that the world hasn't
 * taken: `world_update` brings it in. Read from the world's repository on each
 * request.
 */
export function availableUpdate(live: string): WorldMeta["update"] {
  const world = readWorldPackage(live);
  if (!world) return undefined;
  const git = gitIn(live);
  const release = git && downloadedRelease(git);
  if (!release) return undefined;
  return {
    commit: release.commit,
    ...(release.date ? { date: release.date } : { date: "" }),
    version: release.version,
    ...(release.notes ? { notes: release.notes } : {}),
    ...(release.url ? { url: release.url } : {}),
    systemAgent: world.kazusa.systemAgent,
  };
}
