import path from "node:path";
import { readStickers, type Sticker } from "../stickers/stickers.ts";
import {
  commitOf,
  githubRepo,
  originOf,
  PLAY,
  worldGit,
} from "../world/repo.ts";

/** What a character looks like when no face is named: the calmest sticker. */
const RESTING = ["neutral", "calm", "content", "happy"];

/** The sticker to show for `face`, or the resting one in the usual clothes. */
export function avatarSticker(
  stickers: ReadonlyMap<string, Sticker>,
  face?: string,
): Sticker | undefined {
  if (face) {
    const named = stickers.get(face);
    if (named) return named;
  }
  for (const name of RESTING) {
    const resting = stickers.get(name);
    if (resting) return resting;
  }
  const all = [...stickers.values()];
  return all.find((sticker) => !sticker.outfitWord) ?? all[0];
}

/** A file in the world on GitHub, at the creator's commit the world stands on. */
export interface WorldOnGitHub {
  readonly repo: string;
  readonly commit: string;
  readonly root: string;
}

/** The world's repository on GitHub and its commit; none off GitHub. */
export function worldOnGitHub(world: string): WorldOnGitHub | undefined {
  const git = worldGit(world);
  if (!git) return undefined;
  const origin = originOf(git);
  const repo = origin ? githubRepo(origin) : undefined;
  const commit = commitOf(git, PLAY) ?? commitOf(git, "HEAD");
  return repo && commit ? { repo, commit, root: world } : undefined;
}

/** A world file's public address, or none when it is outside the world. */
export function rawUrl(world: WorldOnGitHub, file: string): string | undefined {
  const relative = path.relative(world.root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return undefined;
  const parts = relative.split(path.sep).map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${world.repo}/${world.commit}/${parts}`;
}

/**
 * Characters' stickers as pictures anyone on the internet can fetch: the
 * world's own files on GitHub, which Discord shows as avatars and images. A
 * picture the creator never committed has no address there, and shows nothing.
 * The repository and commit are looked up at most once a minute.
 */
export function publicPictures(deps: {
  readonly world: string;
  readonly workspaceOf: (agentId: string) => string | undefined;
}): {
  readonly avatarOf: (agentId: string, face?: string) => string | undefined;
  readonly stickerOf: (agentId: string, name: string) => string | undefined;
} {
  let cached: { at: number; value: WorldOnGitHub | undefined } | undefined;
  const github = () => {
    if (!cached || Date.now() - cached.at > 60_000)
      cached = { at: Date.now(), value: worldOnGitHub(deps.world) };
    return cached.value;
  };
  const urlOf = (
    agentId: string,
    pick: (set: ReadonlyMap<string, Sticker>) => Sticker | undefined,
  ) => {
    const world = github();
    const workspace = deps.workspaceOf(agentId);
    if (!world || !workspace) return undefined;
    const sticker = pick(readStickers(workspace).stickers);
    return sticker ? rawUrl(world, sticker.file) : undefined;
  };
  return {
    avatarOf: (agentId, face) =>
      urlOf(agentId, (stickers) => avatarSticker(stickers, face)),
    stickerOf: (agentId, name) =>
      urlOf(agentId, (stickers) => stickers.get(name)),
  };
}
