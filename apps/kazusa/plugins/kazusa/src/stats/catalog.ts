import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { StatCatalogSchema, type StatCatalog } from "@kazusa/client";

/**
 * The world's states are text in the world, `shared/stats.json`: a creator
 * ships them with the world and anyone can edit them by hand. What they stand
 * at is play, and lives in the `"stats"` store.
 */
export function statsFile(): string {
  return path.resolve("shared", "stats.json");
}

/**
 * Names a catalog by what it says, so a save made from an older one is told
 * apart however the file was changed in between.
 */
export function catalogRevision(catalog: StatCatalog): string {
  return createHash("sha256")
    .update(JSON.stringify(catalog))
    .digest("hex")
    .slice(0, 16);
}

export interface CatalogFile {
  /** The states defined, read again whenever the file changes. */
  readonly read: () => StatCatalog;
  /** False while the file is there but can't be read: saving would lose it. */
  readonly readable: () => boolean;
  readonly write: (catalog: StatCatalog) => void;
}

/**
 * A missing file is a world without states. A file that doesn't parse is
 * reported once per change and read as none, so a bad edit never stops a turn.
 * States of the player, from before characters were played, are left out.
 */
export function catalogFile(
  file: string,
  warn: (message: string) => void = () => {},
): CatalogFile {
  let cached: {
    readonly stamp: string;
    readonly catalog: StatCatalog;
    readonly failed: boolean;
  } | null = null;
  const stampOf = (): string | null => {
    try {
      const { mtimeMs, size } = statSync(file);
      return `${mtimeMs}:${size}`;
    } catch {
      return null;
    }
  };
  const load = () => {
    const stamp = stampOf();
    if (stamp === null) return null;
    if (cached?.stamp === stamp) return cached;
    let catalog: StatCatalog = [];
    let failed = false;
    try {
      catalog = StatCatalogSchema.parse(
        withoutPlayer(JSON.parse(readFileSync(file, "utf8")), warn),
      );
    } catch (error) {
      failed = true;
      warn(`States: can't read ${file}: ${String(error)}`);
    }
    cached = { stamp, catalog, failed };
    return cached;
  };
  return {
    read: () => load()?.catalog ?? [],
    readable: () => !load()?.failed,
    write(catalog) {
      mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
      renameSync(temporary, file);
      cached = null;
    },
  };
}

/**
 * Drops states `on: "player"`: the person plays a character now, whose states
 * are the character's, so those have nobody to sit on.
 */
function withoutPlayer(raw: unknown, warn: (message: string) => void): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.filter((entry: unknown) => {
    const { on, name } = (entry ?? {}) as { on?: unknown; name?: unknown };
    if (on !== "player") return true;
    warn(
      `States: "${String(name)}" is a state of the player; it is left out, as the person plays characters now.`,
    );
    return false;
  });
}
