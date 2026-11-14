import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  authorName,
  WorldPackageSchema,
  type WorldMeta,
  type WorldPackage,
} from "@kazusa/client";
import { downloadedRelease, PLAY, worldGit } from "./repo.ts";

/** The world's own manifest, beside its `shared/` and `workspaces/`. */
export const WORLD_PACKAGE = "package.json";

/**
 * The `package.json` in `dir`, parsed; `undefined` when there is none or it
 * doesn't parse.
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
 * taken: `world_update` brings it in. Working it out runs `git` several times,
 * synchronously, and every open page asks for `/kazusa/world`, so the answer is
 * kept until the repository's refs, config or the world's `package.json`
 * change, or for `RECHECK_MS` at most.
 */
export function availableUpdate(live: string): WorldMeta["update"] {
  const kept = keptUpdates();
  const signature = repositorySignature(live);
  const last = kept.get(live);
  if (last && last.signature === signature && Date.now() - last.at < RECHECK_MS)
    return last.update;
  const update = readAvailableUpdate(live);
  kept.set(live, { signature, at: Date.now(), update });
  return update;
}

/** The longest a kept answer is used without asking git again. */
const RECHECK_MS = 5 * 60_000;

const KEPT = Symbol.for("kazusa.world.availableUpdate");

interface KeptUpdate {
  readonly signature: string;
  readonly at: number;
  readonly update: WorldMeta["update"];
}

/** One per process: OpenClaw can load the plugin more than once. */
function keptUpdates(): Map<string, KeptUpdate> {
  const scope = globalThis as { [KEPT]?: Map<string, KeptUpdate> };
  return (scope[KEPT] ??= new Map<string, KeptUpdate>());
}

/**
 * What a downloaded release, the world's own position and the release's address
 * are read from: a fetch adds tags, an update moves `play`.
 */
function repositorySignature(live: string): string {
  return [
    WORLD_PACKAGE,
    ".git/config",
    ".git/HEAD",
    ".git/packed-refs",
    ".git/refs/tags",
    ".git/refs/heads",
    `.git/refs/heads/${PLAY}`,
  ]
    .map((file) => {
      try {
        const stat = statSync(path.join(live, file));
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "-";
      }
    })
    .join("|");
}

function readAvailableUpdate(live: string): WorldMeta["update"] {
  const world = readWorldPackage(live);
  if (!world) return undefined;
  const git = worldGit(live);
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
