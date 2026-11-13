import { createHash } from "node:crypto";
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorldPackage } from "@kazusa/client";
import { renamedText } from "../location/pages.ts";
import { readWorldPackage, WORLD_PACKAGE } from "../world/package.ts";
import { parseDoc, renderDoc } from "./parts.ts";
import {
  mergeMarkdown,
  sameMarkdown,
  type MergePolicy,
  type PartConflict,
} from "./merge.ts";

/**
 * Bringing a live world up to date with a newer version of the template it was
 * copied from. The base is `.template/`: the template exactly as it was last
 * imported or updated, text files verbatim plus a hash of every file.
 * `apps/web/lib/setup/template-snapshot.ts` writes the same layout at import.
 */
export const BASE_DIR = ".template";
/** Runtime state, beside the memory index: backups and the update in progress. */
const STATE_DIR = path.join(".state", "kazusa", "world-update");
const BACKUPS_DIR = path.join(STATE_DIR, "backups");
const REPORT = path.join(STATE_DIR, "report.json");
const MANIFEST = "manifest.json";
const KEEP_BACKUPS = 3;

const TEXT = /\.(md|json|txt)$/;
const PARTS = ["shared", "workspaces"] as const;
/**
 * The world's manifest: an update brings the template's, with its new version,
 * keeping which template the world came from.
 */
const PACKAGE = WORLD_PACKAGE;
const LAYOUT_KEYS = ["fm:map"];

const MANIFEST_SCHEMA = z.object({
  template: z.string(),
  files: z.record(z.string(), z.string()),
});
type Manifest = z.infer<typeof MANIFEST_SCHEMA>;

const sha = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

/** World-relative paths of the files an update covers. */
function filesOf(root: string): string[] {
  const out: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(root, relative);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.name === ".DS_Store" || entry.name.endsWith(".tmp")) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child.split(path.sep).join("/"));
    }
  };
  for (const part of PARTS) if (existsSync(path.join(root, part))) walk(part);
  if (existsSync(path.join(root, PACKAGE))) out.push(PACKAGE);
  return out.sort();
}

/** Records `template` as the base the next update compares against. */
export function writeSnapshot(
  live: string,
  template: string,
  id: string,
): void {
  const dir = path.join(live, BASE_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {};
  for (const file of filesOf(template)) {
    const data = readFileSync(path.join(template, file));
    files[file] = sha(data);
    if (TEXT.test(file)) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
  }
  const manifest: Manifest = { template: id, files };
  writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest)}\n`);
}

function readManifest(live: string): Manifest | undefined {
  const file = path.join(live, BASE_DIR, MANIFEST);
  if (!existsSync(file)) return undefined;
  return MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Which template the live world came from, from its `package.json`. */
export function templateIdOf(live: string): string | undefined {
  return readWorldPackage(live)?.kazusa.template;
}

// ------------------------------------------------------------------- renames

function renamesOf(template: string): Record<string, string> {
  return readWorldPackage(template)?.kazusa.renames ?? {};
}

function renamedPath(file: string, renames: Record<string, string>): string {
  const match = /^(.*\/wiki\/entities\/places\/)([^/]+)\.md$/.exec(file);
  if (!match) return file;
  const to = renames[match[2]];
  return to ? `${match[1]}${to}.md` : file;
}

// ---------------------------------------------------------------------- plan

export type Outcome =
  | "added"
  | "updated"
  | "merged"
  | "conflict"
  | "removed"
  | "orphaned"
  | "kept-deleted"
  | "forgotten";

export interface Change {
  readonly path: string;
  readonly outcome: Outcome;
  /** Live path it came from, when the creator renamed it. */
  readonly from?: string;
  readonly conflicts?: readonly PartConflict[];
  /** What the file becomes; absent for deletions. */
  readonly text?: string;
  readonly copyFromTemplate?: boolean;
  /** Why an orphan needs judgment. */
  readonly reason?: string;
  /** An orphan play left before this update: nothing the creator did now. */
  readonly beforeThisUpdate?: boolean;
}

/** How many files of one kind an update touches, by outcome. */
export interface Area {
  /**
   * The kind of file: `shared/backdrops`, `shared/wiki/entities/places`, or a
   * folder every character has, with `*` for the character's id.
   */
  readonly area: string;
  readonly counts: Readonly<Partial<Record<Outcome, number>>>;
  /** For an area inside workspaces: how many characters it touches. */
  readonly characters?: number;
}

export interface Plan {
  readonly template: string;
  readonly hasBase: boolean;
  readonly renames: Readonly<Record<string, string>>;
  /** The renames this world still has the old ids of; the rest were applied. */
  readonly pendingRenames: Readonly<Record<string, string>>;
  /** What the update changes, by kind of file, biggest first. */
  readonly areas: readonly Area[];
  readonly changes: readonly Change[];
  /** Personal pages where the character's own version won without asking. */
  readonly keptTheirs: number;
  readonly newCharacters: readonly string[];
  readonly removedCharacters: readonly string[];
  /** World places with a position the user arranged, kept or reset. */
  readonly arranged: number;
  /**
   * Arranged places the creator moved: only these make `layout` a real choice,
   * since a kept position otherwise matches nothing the creator did.
   */
  readonly arrangedMoved: number;
  /**
   * No base: what play wrote is guessed from its marks, so this can go badly,
   * worst of all if this world was never really a copy of the template.
   */
  readonly bestAttempt: boolean;
  /** Share of this world's pages the template also has; low means unrelated. */
  readonly overlap: number;
  /**
   * Without a base, pages here the template lacks are kept: removed upstream,
   * or the user's own.
   */
  readonly notInTemplate: readonly string[];
}

/**
 * The kind of file a path is, for telling the user what an update brings: the
 * folder it's in, with a character's id as a star and a wiki's entity type
 * kept.
 */
export function areaOf(file: string): { area: string; character?: string } {
  const parts = file.split("/");
  const character = parts[0] === "workspaces" ? parts[1] : undefined;
  const prefix = character ? ["workspaces", "*"] : parts.slice(0, 1);
  const rest = parts.slice(prefix.length);
  if (!rest.length) return { area: file };
  const keep = rest[0] === "wiki" ? (rest[1] === "entities" ? 3 : 2) : 1;
  const area = [...prefix, ...rest.slice(0, Math.min(keep, rest.length))].join(
    "/",
  );
  return character ? { area, character } : { area };
}

function areasOf(changes: readonly Change[]): Area[] {
  const byArea = new Map<
    string,
    { counts: Partial<Record<Outcome, number>>; characters: Set<string> }
  >();
  for (const { path: file, outcome } of changes) {
    const { area, character } = areaOf(file);
    const entry = byArea.get(area) ?? { counts: {}, characters: new Set() };
    entry.counts[outcome] = (entry.counts[outcome] ?? 0) + 1;
    if (character) entry.characters.add(character);
    byArea.set(area, entry);
  }
  const total = (counts: Partial<Record<Outcome, number>>) =>
    Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  return [...byArea]
    .map(([area, { counts, characters }]) => ({
      area,
      counts,
      ...(characters.size ? { characters: characters.size } : {}),
    }))
    .sort((a, b) => total(b.counts) - total(a.counts));
}

const ownerOf = (file: string): MergePolicy["owner"] =>
  /^workspaces\/[^/]+\/(wiki\/|MEMORY\.md$)/.test(file) ? "personal" : "world";

const CHARACTER = /^shared\/wiki\/entities\/characters\/([^/]+)\.md$/;
const PLACE = /^shared\/wiki\/entities\/places\/([^/]+)\.md$/;
const CARD = /^workspaces\/[^/]+\/wiki\/entities\/places\/([^/]+)\.md$/;

/** Keys and sections only play writes: visit stamps, sleep, the map layout. */
const PLAY_KEYS = new Set([
  "fm:map",
  "fm:seen",
  "fm:first_visited_iso",
  "fm:relation",
]);
const PLAY_SECTION =
  /^section:(notes|history|lately|plans recorded for .*|what they think of me|open threads|see also|dream)(#\d+)?$/;

/**
 * Without a base, a stand-in for one: the live page minus what play visibly
 * wrote. A page play never touched then takes the creator's version; on a
 * character's page play did touch, any text that differs is a conflict.
 */
function standIn(text: string, owner: MergePolicy["owner"]): string {
  const doc = parseDoc(text);
  const isPlay = (key: string) => PLAY_KEYS.has(key) || PLAY_SECTION.test(key);
  const played = [...doc.front, ...doc.body].some(({ key }) => isPlay(key));
  const front = doc.front.filter(
    ({ key }) =>
      !isPlay(key) && !(owner === "personal" && played && key === "fm:summary"),
  );
  const body = doc.body.filter(
    ({ key }) =>
      !isPlay(key) && !(owner === "personal" && played && key !== "title"),
  );
  return renderDoc({ front, body });
}

function overlapOf(
  live: Iterable<string>,
  template: ReadonlySet<string>,
): number {
  const pages = [...live].filter((file) => file.endsWith(".md"));
  if (!pages.length) return 1;
  return (
    Math.round(
      (pages.filter((file) => template.has(file)).length / pages.length) * 100,
    ) / 100
  );
}

export function planUpdate(
  live: string,
  template: string,
  options: { readonly layout: MergePolicy["layout"] },
): Plan {
  const id = templateIdOf(live) ?? path.basename(template);
  const manifest = readManifest(live);
  const bestAttempt = manifest === undefined;
  const notInTemplate: string[] = [];
  const renames = renamesOf(template);
  const baseDir = path.join(live, BASE_DIR);

  const liveFiles = new Map<string, string>();
  for (const file of filesOf(live))
    liveFiles.set(renamedPath(file, renames), file);
  const baseFiles = new Set(
    Object.keys(manifest?.files ?? {}).map((file) =>
      renamedPath(file, renames),
    ),
  );
  const baseOriginal = new Map(
    Object.keys(manifest?.files ?? {}).map((file) => [
      renamedPath(file, renames),
      file,
    ]),
  );
  const templateFiles = new Set(filesOf(template));
  const all = [
    ...new Set([...liveFiles.keys(), ...templateFiles, ...baseFiles]),
  ].sort();

  const read = (file: string) => readFileSync(file, "utf8");
  const liveText = (file: string) =>
    renamedText(read(path.join(live, liveFiles.get(file)!)), renames);
  const liveHash = (file: string) =>
    sha(readFileSync(path.join(live, liveFiles.get(file)!)));
  const baseText = (file: string) => {
    const original = baseOriginal.get(file)!;
    const full = path.join(baseDir, original);
    return existsSync(full) ? renamedText(read(full), renames) : undefined;
  };
  const baseHash = (file: string) => manifest!.files[baseOriginal.get(file)!];
  const templateText = (file: string) => read(path.join(template, file));
  const templateHash = (file: string) =>
    sha(readFileSync(path.join(template, file)));

  const changes: Change[] = [];
  let keptTheirs = 0;
  let arranged = 0;
  let arrangedMoved = 0;
  const mapLine = (text: string | undefined) =>
    text === undefined ? undefined : (/^map:.*$/m.exec(text)?.[0] ?? null);
  for (const file of all) {
    const inL = liveFiles.has(file);
    const inT = templateFiles.has(file);
    const inB = baseFiles.has(file);
    const from =
      inL && liveFiles.get(file) !== file ? { from: liveFiles.get(file)! } : {};
    const md = file.endsWith(".md");
    if (file === PACKAGE) {
      if (!inT || !inL) continue;
      // The template's as written, so its key order and fields survive.
      const theirs = JSON.parse(templateText(file)) as WorldPackage;
      const next = { ...theirs, kazusa: { ...theirs.kazusa, template: id } };
      const current: unknown = JSON.parse(read(path.join(live, file)));
      if (JSON.stringify(next) !== JSON.stringify(current))
        changes.push({
          path: file,
          outcome: "updated",
          text: `${JSON.stringify(next, null, 2)}\n`,
        });
      continue;
    }
    if (!inT && !inL) continue;
    if (inT && !inL) {
      if (!inB)
        changes.push({ path: file, outcome: "added", copyFromTemplate: true });
      else if (templateHash(file) !== baseHash(file))
        changes.push({ path: file, outcome: "kept-deleted" });
      continue;
    }
    if (!inT && inL) {
      if (!inB) {
        if (bestAttempt && !from.from && file.startsWith("shared/"))
          notInTemplate.push(file);
        if (from.from)
          changes.push({
            path: file,
            outcome: "updated",
            ...from,
            text: liveText(file),
          });
        continue;
      }
      const unchanged = md
        ? baseText(file) !== undefined &&
          sameMarkdown(liveText(file), baseText(file)!, LAYOUT_KEYS)
        : liveHash(file) === baseHash(file);
      changes.push({
        path: file,
        outcome: unchanged ? "removed" : "orphaned",
        ...(unchanged
          ? {}
          : { reason: "the creator removed it; it changed here" }),
        ...from,
      });
      continue;
    }
    // In both.
    const policy: MergePolicy = {
      owner: ownerOf(file),
      layout: options.layout,
    };
    if (md) {
      const t = templateText(file);
      const l = liveText(file);
      const b = inB
        ? baseText(file)
        : bestAttempt
          ? standIn(l, policy.owner)
          : undefined;
      if (PLACE.test(file) && /^map:/m.test(l) && !(b && /^map:/m.test(b))) {
        arranged++;
        if (mapLine(t) !== mapLine(b)) arrangedMoved++;
      }
      if (sameMarkdown(l, t) && !from.from) continue;
      const merged = mergeMarkdown(b, t, l, policy);
      keptTheirs += merged.keptTheirs;
      if (
        sameMarkdown(merged.text, l) &&
        !from.from &&
        !merged.conflicts.length
      )
        continue;
      const outcome: Outcome = merged.conflicts.length
        ? "conflict"
        : b !== undefined && sameMarkdown(l, b, LAYOUT_KEYS)
          ? "updated"
          : "merged";
      changes.push({
        path: file,
        outcome,
        ...from,
        text: merged.text,
        ...(merged.conflicts.length ? { conflicts: merged.conflicts } : {}),
      });
      continue;
    }
    const [l, t] = [liveHash(file), templateHash(file)];
    if (l === t && !from.from) continue;
    const b = inB ? baseHash(file) : bestAttempt ? l : undefined;
    if (l === b)
      changes.push({
        path: file,
        outcome: "updated",
        ...from,
        copyFromTemplate: true,
      });
    else if (t !== b)
      changes.push({
        path: file,
        outcome: "conflict",
        ...from,
        conflicts: [{ part: "file" }],
      });
  }

  // A card for a place that no longer exists is forgotten, unless it holds
  // something the character wrote: then where it belongs is for judgment.
  const removed = new Set(
    changes
      .filter(({ outcome }) => outcome === "removed")
      .map(({ path: file }) => file),
  );
  const places = new Set(
    [...new Set([...liveFiles.keys(), ...templateFiles])]
      .filter((file) => PLACE.test(file) && !removed.has(file))
      .map((file) => PLACE.exec(file)![1]),
  );
  const planned = new Map(changes.map((change) => [change.path, change]));
  for (const file of liveFiles.keys()) {
    const card = CARD.exec(file)?.[1];
    if (!card || places.has(card) || templateFiles.has(file)) continue;
    const text = liveText(file);
    const ownWords = parseDoc(text).body.some(({ key }) => key !== "title");
    const seed =
      baseFiles.has(file) &&
      baseText(file) !== undefined &&
      sameMarkdown(text, baseText(file)!, LAYOUT_KEYS);
    const from =
      liveFiles.get(file) !== file ? { from: liveFiles.get(file)! } : {};
    planned.set(
      file,
      ownWords && !seed
        ? {
            path: file,
            outcome: "orphaned",
            ...(baseFiles.has(`shared/wiki/entities/places/${card}.md`)
              ? { reason: "its place no longer exists" }
              : {
                  reason: "its place was already gone before this update",
                  beforeThisUpdate: true,
                }),
            ...from,
          }
        : { path: file, outcome: "forgotten", ...from },
    );
  }

  const pendingRenames = Object.fromEntries(
    Object.entries(renames).filter(([from]) =>
      [...liveFiles.values()].some(
        (file) => renamedPath(file, { [from]: renames[from] }) !== file,
      ),
    ),
  );
  const finalChanges = [...planned.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  const characters = (files: Iterable<string>) =>
    new Set(
      [...files]
        .map((file) => CHARACTER.exec(file)?.[1])
        .filter((x): x is string => !!x),
    );
  const before = characters(liveFiles.keys());
  const after = characters(templateFiles);
  const base = characters(baseFiles);
  return {
    template: id,
    hasBase: !bestAttempt,
    bestAttempt,
    overlap: overlapOf(liveFiles.keys(), templateFiles),
    notInTemplate,
    renames,
    pendingRenames,
    areas: areasOf(finalChanges),
    changes: finalChanges,
    keptTheirs,
    newCharacters: [...after].filter((who) => !before.has(who)),
    removedCharacters: [...base].filter(
      (who) => !after.has(who) && before.has(who),
    ),
    arranged,
    arrangedMoved,
  };
}

// --------------------------------------------------------------------- apply

export interface Report {
  readonly template: string;
  readonly stage: "applied" | "finished";
  readonly backup: string;
  readonly layout: MergePolicy["layout"];
  readonly counts: Readonly<Record<string, number>>;
  readonly conflicts: readonly {
    path: string;
    parts: readonly PartConflict[];
  }[];
  readonly orphaned: readonly { path: string; reason: string }[];
  readonly keptDeleted: readonly string[];
  readonly newCharacters: readonly string[];
  readonly removedCharacters: readonly string[];
  readonly renames: Readonly<Record<string, string>>;
}

function backup(live: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(live, BACKUPS_DIR, stamp);
  mkdirSync(dir, { recursive: true });
  const copy = (relative: string) => {
    const from = path.join(live, relative);
    if (!existsSync(from)) return;
    cpSync(from, path.join(dir, relative), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
    });
  };
  for (const part of [...PARTS, PACKAGE, BASE_DIR]) copy(part);
  const all = readdirSync(path.join(live, BACKUPS_DIR)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)))
    rmSync(path.join(live, BACKUPS_DIR, old), { recursive: true, force: true });
  return path.join(BACKUPS_DIR, stamp);
}

function write(file: string, data: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export function applyUpdate(
  live: string,
  template: string,
  plan: Plan,
  layout: MergePolicy["layout"],
): Report {
  const saved = backup(live);
  for (const change of plan.changes) {
    const target = path.join(live, change.path);
    if (change.from) rmSync(path.join(live, change.from), { force: true });
    if (change.outcome === "removed" || change.outcome === "forgotten") {
      rmSync(target, { force: true });
    } else if (change.copyFromTemplate) {
      write(target, readFileSync(path.join(template, change.path)));
    } else if (change.text !== undefined) {
      write(target, change.text);
    }
  }
  const counts: Record<string, number> = {};
  for (const { outcome } of plan.changes)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  const report: Report = {
    template: plan.template,
    stage: "applied",
    backup: saved,
    layout,
    counts,
    conflicts: plan.changes
      .filter(({ outcome }) => outcome === "conflict")
      .map(({ path: file, conflicts }) => ({
        path: file,
        parts: conflicts ?? [],
      })),
    orphaned: plan.changes
      .filter(({ outcome }) => outcome === "orphaned")
      .map(({ path: file, reason }) => ({ path: file, reason: reason ?? "" })),
    keptDeleted: plan.changes
      .filter(({ outcome }) => outcome === "kept-deleted")
      .map(({ path: file }) => file),
    newCharacters: plan.newCharacters,
    removedCharacters: plan.removedCharacters,
    renames: plan.renames,
  };
  mkdirSync(path.join(live, STATE_DIR), { recursive: true });
  writeFileSync(
    path.join(live, REPORT),
    `${JSON.stringify(report, null, 1)}\n`,
  );
  return report;
}

export function readReport(live: string): Report | undefined {
  const file = path.join(live, REPORT);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Report)
    : undefined;
}

export function finishUpdate(
  live: string,
  template: string,
  id: string,
): Report {
  const report = readReport(live);
  if (!report || report.stage !== "applied")
    throw new Error("No applied update to finish.");
  writeSnapshot(live, template, id);
  const done: Report = { ...report, stage: "finished" };
  writeFileSync(path.join(live, REPORT), `${JSON.stringify(done, null, 1)}\n`);
  return done;
}

/**
 * Puts the world's files back as they were before the last apply. Positions
 * moved by finishing stay where they are.
 */
export function undoUpdate(live: string): string {
  const report = readReport(live);
  if (!report) throw new Error("No update to undo.");
  const dir = path.join(live, report.backup);
  if (!existsSync(dir)) throw new Error(`The backup ${report.backup} is gone.`);
  for (const part of [...PARTS, PACKAGE, BASE_DIR]) {
    const source = path.join(dir, part);
    const target = path.join(live, part);
    if (!existsSync(source)) {
      // A manifest the update added goes with it.
      if (part === PACKAGE) rmSync(target, { force: true });
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
    });
  }
  rmSync(path.join(live, REPORT), { force: true });
  return report.backup;
}
