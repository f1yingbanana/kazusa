import { randomUUID } from "node:crypto";
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

export interface CatalogFile {
  /** The states defined, read again whenever the file changes. */
  readonly read: () => StatCatalog;
  readonly write: (catalog: StatCatalog) => void;
}

/**
 * A missing file is a world without states. A file that doesn't parse is
 * reported once per change and read as none, so a bad edit never stops a turn.
 */
export function catalogFile(
  file: string,
  warn: (message: string) => void = () => {},
): CatalogFile {
  let cached: { readonly stamp: string; readonly catalog: StatCatalog } | null =
    null;
  const stampOf = (): string | null => {
    try {
      const { mtimeMs, size } = statSync(file);
      return `${mtimeMs}:${size}`;
    } catch {
      return null;
    }
  };
  return {
    read() {
      const stamp = stampOf();
      if (stamp === null) return [];
      if (cached?.stamp === stamp) return cached.catalog;
      let catalog: StatCatalog = [];
      try {
        catalog = StatCatalogSchema.parse(
          JSON.parse(readFileSync(file, "utf8")),
        );
      } catch (error) {
        warn(`States: can't read ${file}: ${String(error)}`);
      }
      cached = { stamp, catalog };
      return catalog;
    },
    write(catalog) {
      mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
      renameSync(temporary, file);
      cached = null;
    },
  };
}
