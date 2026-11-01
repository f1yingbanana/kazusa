import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorldModel, type Anchors } from "./knowledge.ts";
import { parsePage, type Page } from "./page.ts";

export const WORLD_SCOPE = "world";
export const personalScope = (agentId: string): string => `agent:${agentId}`;

/** H: a dated `## History` line, which only some ever hear of. */
export type ChunkLayer = "L0" | "L1" | "L2" | "H";

export interface SearchHit {
  readonly scope: string;
  readonly pageId: string;
  readonly layer: ChunkLayer;
  readonly text: string;
  /** Character ids a `Known by:` section is limited to; empty means anyone. */
  readonly knownBy: readonly string[];
  /** Higher is better; only comparable within one search. */
  readonly score: number;
  /** For `H`: its date, and whether it was public news. */
  readonly date?: string;
  readonly news?: boolean;
}

interface Known {
  readonly mtimeMs: number;
  readonly size: number;
  readonly hash: string;
  readonly page: Page;
}

/** Index files, not pages (`INDEX.md`, `KIVOTOS_INDEX.md`). */
const isPage = (name: string): boolean =>
  name.endsWith(".md") && !/^(?:[A-Z_]+_)?INDEX\.md$/.test(name);

export const STOPWORDS = new Set(
  (
    "the a an and or but if then than that this these those to of in on at for from by with " +
    "about into over under is are was were be been being am do does did done have has had " +
    "having it its i me my mine you your yours he him his she her hers we us our they them " +
    "their not no yes so too very just can could will would shall should may might must " +
    "what which who whom when where why how all any some more most other such only own same " +
    "there here out up down off again once also still even really like get got go going went " +
    "come came know think thought want say said tell told see saw look today tomorrow yesterday " +
    "now hey hi hello ok okay please thanks thank make made take took good one two way ever"
  ).split(" "),
);

/**
 * Ordinary words that are also names. Names are recognized as names, so these
 * never count as search words, and one counts as a name only capitalized
 * mid-sentence. Generic on purpose; a world's own aliases are never filtered.
 */
export const NAME_LIKE_WORDS = new Set(
  (
    "hope faith grace joy may june april august will mark bill rob sue pat art " +
    "rose lily ivy dawn eve summer autumn iris hazel amber ruby pearl jade " +
    "hunter mason parker cooper taylor carter fisher baker miller smith " +
    "drew chase grant lance jack frank earl dean major sage wren robin hare " +
    "fox wolf bear hawk"
  ).split(" "),
);

/** The words worth searching for, as one FTS5 `OR` query. */
export function searchQuery(text: string): string | undefined {
  const words = new Set<string>();
  for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (word.length >= 3 && !STOPWORDS.has(word) && !NAME_LIKE_WORDS.has(word))
      words.add(word);
    if (words.size >= 24) break;
  }
  return words.size
    ? [...words].map((word) => `"${word}"`).join(" OR ")
    : undefined;
}

export function chunksOf(page: Page): Array<{
  layer: ChunkLayer;
  text: string;
  knownBy: readonly string[];
  date?: string;
  news?: boolean;
}> {
  const open = (layer: ChunkLayer, text: string) => ({
    layer,
    text,
    knownBy: [] as readonly string[],
  });
  return [
    open("L0", [page.name, ...page.aliases, page.summary].join(" · ")),
    ...(page.lead ? [open("L1", page.lead)] : []),
    // One bullet or paragraph at a time: long sections otherwise lose to any
    // short page that mentions the word once.
    ...page.sections.flatMap((section) =>
      section.text
        .split(/\n\s*\n|\n(?=[-*] )/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => ({
          layer: "L2" as const,
          text: `${section.title}: ${part}`,
          knownBy: section.knownBy,
        })),
    ),
    ...page.openThreads.map((thread) => open("L1", thread)),
    ...(page.theyThinkOfMe ? [open("L1", page.theyThinkOfMe)] : []),
    ...page.notes.map((note) => open("L2", note.text)),
    ...page.history.map((line) => ({
      layer: "H" as const,
      text: line.text,
      knownBy: [] as readonly string[],
      date: line.date,
      news: line.news,
    })),
  ];
}

interface EmbeddedChunk {
  readonly date?: string;
  readonly news?: boolean;
  readonly pageId: string;
  readonly layer: ChunkLayer;
  readonly knownBy: readonly string[];
  readonly text: string;
  readonly vector: Float32Array;
}

const textHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export interface MemoryIndexOptions {
  readonly worldDir: string;
  /** Where vectors persist, since they cost money to rebuild. */
  readonly vectorsPath?: string;
  readonly model?: string;
  /** Which card fields place a character in this world. */
  readonly anchors?: Anchors;
  readonly workspaceDir: (agentId: string) => string | undefined;
  /** How stale the world may be, so a busy cast doesn't rescan per turn. */
  readonly worldRefreshMs?: number;
  readonly now?: () => number;
}

/**
 * Parsed pages and keyword search over both wikis. Markdown stays the only
 * truth: this is rebuilt from the files, and a stat of the files before each
 * use is what brings a human edit into the next turn, with no watcher.
 */
export class MemoryIndex {
  private readonly db = new DatabaseSync(":memory:");
  private readonly files = new Map<string, Map<string, Known>>();
  private worldModel?: WorldModel;
  private worldCheckedAt = 0;
  private readonly vectors: DatabaseSync;
  /** Vectors by chunk text hash, loaded once. */
  private readonly vectorByHash = new Map<string, Float32Array>();
  private readonly options: MemoryIndexOptions;

  constructor(options: MemoryIndexOptions) {
    this.options = options;
    if (options.vectorsPath)
      mkdirSync(path.dirname(options.vectorsPath), { recursive: true });
    this.vectors = new DatabaseSync(options.vectorsPath ?? ":memory:");
    this.vectors.exec(
      "CREATE TABLE IF NOT EXISTS vectors (hash TEXT, model TEXT, vector BLOB, PRIMARY KEY (hash, model))",
    );
    const rows = this.vectors
      .prepare("SELECT hash, vector FROM vectors WHERE model = ?")
      .all(options.model ?? "") as Array<{ hash: string; vector: Uint8Array }>;
    for (const row of rows) {
      this.vectorByHash.set(
        row.hash,
        new Float32Array(row.vector.slice().buffer),
      );
    }
    this.db.exec(
      "CREATE VIRTUAL TABLE chunks USING fts5(scope UNINDEXED, page UNINDEXED, layer UNINDEXED, known_by UNINDEXED, date UNINDEXED, news UNINDEXED, text, tokenize = 'porter unicode61 remove_diacritics 2')",
    );
  }

  /** Rescans one root; true when anything changed. */
  private sync(scope: string, root: string): boolean {
    const known = this.files.get(scope) ?? new Map<string, Known>();
    this.files.set(scope, known);
    const present = new Set<string>();
    let changed = false;
    const walk = (directory: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filename);
          continue;
        }
        if (!entry.isFile() || !isPage(entry.name)) continue;
        const relative = path.relative(root, filename);
        present.add(relative);
        let stat;
        try {
          stat = statSync(filename);
        } catch {
          continue;
        }
        const before = known.get(relative);
        if (before?.mtimeMs === stat.mtimeMs && before.size === stat.size)
          continue;
        const raw = readFileSync(filename, "utf8");
        const hash = createHash("sha256").update(raw).digest("hex");
        const page =
          before?.hash === hash ? before.page : parsePage(raw, relative);
        known.set(relative, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          hash,
          page,
        });
        if (before?.hash === hash) continue;
        changed = true;
        if (before) this.remove(scope, before.page.id);
        this.insert(scope, page);
      }
    };
    walk(root);
    for (const [relative, gone] of known) {
      if (present.has(relative)) continue;
      known.delete(relative);
      this.remove(scope, gone.page.id);
      changed = true;
    }
    return changed;
  }

  private remove(scope: string, pageId: string): void {
    this.db
      .prepare("DELETE FROM chunks WHERE scope = ? AND page = ?")
      .run(scope, pageId);
  }

  private insert(scope: string, page: Page): void {
    const statement = this.db.prepare(
      "INSERT INTO chunks (scope, page, layer, known_by, date, news, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const chunk of chunksOf(page)) {
      statement.run(
        scope,
        page.id,
        chunk.layer,
        chunk.knownBy.join(","),
        chunk.date ?? "",
        chunk.news ? 1 : 0,
        chunk.text,
      );
    }
  }

  /** The world as of now; rebuilt only when a world file changed. */
  world(): WorldModel {
    const now = this.options.now?.() ?? Date.now();
    if (
      !this.worldModel ||
      now - this.worldCheckedAt >= (this.options.worldRefreshMs ?? 1_000)
    ) {
      this.worldCheckedAt = now;
      if (this.sync(WORLD_SCOPE, this.options.worldDir) || !this.worldModel) {
        this.worldModel = new WorldModel(
          [...this.files.get(WORLD_SCOPE)!.values()].map(({ page }) => page),
          this.options.anchors,
        );
      }
    }
    return this.worldModel;
  }

  /** One character's own pages by id, fresh from disk. */
  personal(agentId: string): ReadonlyMap<string, Page> {
    const scope = personalScope(agentId);
    const workspace = this.options.workspaceDir(agentId);
    if (workspace) this.sync(scope, path.join(workspace, "wiki"));
    const pages = new Map<string, Page>();
    for (const { page } of this.files.get(scope)?.values() ?? [])
      pages.set(page.id, page);
    return pages;
  }

  /** BM25 over the world and this character's pages only. */
  search(agentId: string, text: string, limit = 200): SearchHit[] {
    const query = searchQuery(text);
    if (!query) return [];
    const rows = this.db
      .prepare(
        "SELECT scope, page, layer, known_by, date, news, text, bm25(chunks) AS rank FROM chunks WHERE chunks MATCH ? AND scope IN (?, ?) ORDER BY rank LIMIT ?",
      )
      .all(query, WORLD_SCOPE, personalScope(agentId), limit) as Array<{
      scope: string;
      page: string;
      layer: ChunkLayer;
      known_by: string;
      date: string;
      news: number;
      text: string;
      rank: number;
    }>;
    return rows.map((row) => ({
      scope: row.scope,
      pageId: row.page,
      layer: row.layer,
      text: row.text,
      knownBy: row.known_by ? row.known_by.split(",") : [],
      score: -row.rank,
      ...(row.date ? { date: row.date, news: row.news === 1 } : {}),
    }));
  }

  /** Chunk texts of these scopes that have no vector yet. */
  unembedded(scopes: readonly string[], limit: number): string[] {
    const pending = new Set<string>();
    for (const scope of scopes) {
      for (const { page } of this.files.get(scope)?.values() ?? []) {
        for (const chunk of chunksOf(page)) {
          if (!this.vectorByHash.has(textHash(chunk.text)))
            pending.add(chunk.text);
          if (pending.size >= limit) return [...pending];
        }
      }
    }
    return [...pending];
  }

  addVectors(
    entries: ReadonlyArray<readonly [string, readonly number[]]>,
  ): void {
    const statement = this.vectors.prepare(
      "INSERT OR REPLACE INTO vectors (hash, model, vector) VALUES (?, ?, ?)",
    );
    for (const [text, values] of entries) {
      const vector = Float32Array.from(values);
      const hash = textHash(text);
      this.vectorByHash.set(hash, vector);
      statement.run(
        hash,
        this.options.model ?? "",
        new Uint8Array(vector.buffer),
      );
    }
  }

  private embedded(scope: string): EmbeddedChunk[] {
    const chunks: EmbeddedChunk[] = [];
    for (const { page } of this.files.get(scope)?.values() ?? []) {
      for (const chunk of chunksOf(page)) {
        const vector = this.vectorByHash.get(textHash(chunk.text));
        if (vector)
          chunks.push({
            pageId: page.id,
            layer: chunk.layer,
            knownBy: chunk.knownBy,
            text: chunk.text,
            vector,
            ...(chunk.date ? { date: chunk.date, news: chunk.news } : {}),
          });
      }
    }
    return chunks;
  }

  /** Cosine over the world and this character's pages only, best first. */
  nearest(agentId: string, query: Float32Array, limit = 200): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const scope of [WORLD_SCOPE, personalScope(agentId)]) {
      for (const chunk of this.embedded(scope)) {
        if (chunk.vector.length !== query.length) continue;
        hits.push({
          scope,
          pageId: chunk.pageId,
          layer: chunk.layer,
          text: chunk.text,
          knownBy: chunk.knownBy,
          score: cosine(query, chunk.vector),
          ...(chunk.date ? { date: chunk.date, news: chunk.news } : {}),
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
