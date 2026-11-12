import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PlacesResponse } from "@kazusa/client";
import { z } from "zod";
import {
  fileMtime,
  PICTURE_NAME,
  pictureVersion,
  readPictures,
  splitPictureName,
} from "../pictures.ts";

/** `<set>/backdrops.json`: what the file names can't say. */
const MANIFEST = z.object({
  /** Each state of the place a picture can show, by its name prefix. */
  states: z.record(z.string(), z.string().trim().min(1)).optional(),
});

export interface BackdropFile {
  /** `[<state>-]<time>`. */
  readonly name: string;
  readonly file: string;
  readonly contentType: string;
  /** The file's mtime in base 36: a new file is a new URL. */
  readonly version: string;
  /** The state's word, when the set's `backdrops.json` declares it. */
  readonly state?: string;
  /** The rest of the name, dashes kept: a time of day, by convention. */
  readonly time: string;
}

export interface BackdropSet {
  /** By name, sorted. */
  readonly files: ReadonlyMap<string, BackdropFile>;
  /** State word → what it means, for states some picture shows. */
  readonly states: ReadonlyMap<string, string>;
}

/** Every set with at least one picture, by name. */
export interface BackdropLibrary {
  readonly sets: ReadonlyMap<string, BackdropSet>;
  /** Changes with any picture or manifest the library reads, and only then. */
  readonly key: string;
}

/**
 * The world's backdrop library, `shared/backdrops/`, beside its World Wiki
 * (`shared/wiki/`): both are the world's, under the Gateway's cwd.
 */
export const backdropsBeside = (wikiDir: string): string =>
  path.join(path.dirname(wikiDir), "backdrops");

function readManifest(file: string): z.infer<typeof MANIFEST> {
  try {
    return MANIFEST.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // No or unreadable manifest: every name is a time.
    return {};
  }
}

/** A set and what its reading depended on. */
function readSet(
  libraryDir: string,
  set: string,
): { readonly set: BackdropSet; readonly key: unknown } | undefined {
  if (!PICTURE_NAME.safeParse(set).success) return undefined;
  const dir = path.join(libraryDir, set);
  const pictures = readPictures(dir);
  if (!pictures?.length) return undefined;
  const manifestFile = path.join(dir, "backdrops.json");
  const declared = new Map(
    Object.entries(readManifest(manifestFile).states ?? {}),
  );
  const files = new Map<string, BackdropFile>();
  const states = new Map<string, string>();
  for (const { name, file, contentType, modified } of pictures) {
    const { prefix, rest } = splitPictureName(name, declared);
    const meaning = prefix === undefined ? undefined : declared.get(prefix);
    if (prefix !== undefined && meaning !== undefined)
      states.set(prefix, meaning);
    files.set(name, {
      name,
      file,
      contentType,
      version: pictureVersion(modified),
      ...(prefix === undefined ? {} : { state: prefix }),
      time: rest,
    });
  }
  return {
    set: { files, states },
    key: [
      set,
      fileMtime(manifestFile) ?? null,
      pictures.map(({ file, modified }) => [file, modified]),
    ],
  };
}

/**
 * One set (`<library>/<set>/`), read from disk. `undefined` when the name is
 * not a set name, the folder can't be listed, or it holds no picture, so no
 * name can reach outside the library.
 */
export const readBackdropSet = (
  libraryDir: string,
  set: string,
): BackdropSet | undefined => readSet(libraryDir, set)?.set;

/** Every set in the library with a picture. A missing library has none. */
export function readBackdrops(libraryDir: string): BackdropLibrary {
  let entries: string[];
  try {
    entries = readdirSync(libraryDir).sort();
  } catch {
    entries = [];
  }
  const sets = new Map<string, BackdropSet>();
  const keys: unknown[] = [];
  for (const entry of entries) {
    const read = readSet(libraryDir, entry);
    if (!read) continue;
    sets.set(entry, read.set);
    keys.push(read.key);
  }
  return { sets, key: JSON.stringify(keys) };
}

/** Browser URL of a backdrop; the version keeps it cacheable forever. */
export function backdropUrl(
  set: string,
  file: { readonly name: string; readonly version: string },
): string {
  const query = new URLSearchParams({
    set,
    name: file.name,
    v: file.version,
  });
  return `/kazusa/backdrop?${query}`;
}

/** The library as `GET /kazusa/places` sends it. */
export function backdropsOnWire(
  library: BackdropLibrary | undefined,
): PlacesResponse["backdrops"] {
  const wire: PlacesResponse["backdrops"] = {};
  for (const [name, set] of library?.sets ?? []) {
    wire[name] = {
      files: [...set.files.values()].map((file) => ({
        name: file.name,
        url: backdropUrl(name, file),
        ...(file.state === undefined ? {} : { state: file.state }),
        time: file.time,
      })),
      ...(set.states.size > 0
        ? { states: Object.fromEntries(set.states) }
        : {}),
    };
  }
  return wire;
}
