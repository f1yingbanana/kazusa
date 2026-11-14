import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { WorldPackageSchema, type WorldPackage } from "@kazusa/client";
import { renamedText } from "../location/pages.ts";
import { readWorldPackage, WORLD_PACKAGE } from "../world/package.ts";
import { blobId, copyFiles, filesAt, readBlobs, type Git } from "./git.ts";
import { parseDoc, renderDoc } from "./parts.ts";
import {
  mergeMarkdown,
  sameMarkdown,
  type MergePolicy,
  type PartConflict,
} from "./merge.ts";

/**
 * Bringing a live world up to date with a newer release of the world it was
 * cloned from (`git.ts`): the release is one side, the world as play left it
 * the other, and the base is the creator's commit the world stood on. Both
 * commits are read straight from git; pictures are copied from git only where
 * the world takes them.
 */
/** Runtime state, beside the memory index: the update being resolved. */
const STATE_DIR = path.join(".state", "kazusa", "world-update");
const REPORT = path.join(STATE_DIR, "report.json");

const PARTS = ["shared", "workspaces"] as const;
/**
 * The world's manifest: an update brings the creator's, keeping which world
 * this is a copy of.
 */
const PACKAGE = WORLD_PACKAGE;
const LAYOUT_KEYS = ["fm:map"];
const TEXT = /\.(md|json|txt)$/;

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

/**
 * One side of a merge: which files it has (by blob id), each text file's text,
 * and how to copy its files into the world.
 */
export interface Tree {
  readonly ids: ReadonlyMap<string, string>;
  readonly text: (file: string) => string | undefined;
  readonly copy: (files: readonly string[], live: string) => void;
}

/** A folder as one side (tests). */
export function folderTree(dir: string): Tree {
  return {
    ids: new Map(
      filesOf(dir).map((file) => [
        file,
        blobId(readFileSync(path.join(dir, file))),
      ]),
    ),
    text: (file) =>
      existsSync(path.join(dir, file))
        ? readFileSync(path.join(dir, file), "utf8")
        : undefined,
    copy: (files, live) => {
      for (const file of files)
        write(path.join(live, file), readFileSync(path.join(dir, file)));
    },
  };
}

/** A commit as one side: its text read from git in one batch, when first asked. */
export function commitTree(git: Git, commit: string): Tree {
  const ids = filesAt(git, commit);
  let texts: Map<string, Buffer> | undefined;
  return {
    ids,
    text: (file) => {
      const id = ids.get(file);
      if (!id) return undefined;
      texts ??= readBlobs(
        git,
        [...ids].filter(([name]) => TEXT.test(name)).map(([, blob]) => blob),
      );
      return (texts.get(id) ?? readBlobs(git, [id]).get(id))?.toString("utf8");
    },
    copy: (files) => copyFiles(git, commit, files),
  };
}

/** Which template the live world came from, from its `package.json`. */
export function templateIdOf(live: string): string | undefined {
  return readWorldPackage(live)?.kazusa.template;
}

// ------------------------------------------------------------------- renames

function renamesOf(template: Tree): Record<string, string> {
  try {
    return (
      WorldPackageSchema.safeParse(JSON.parse(template.text(PACKAGE) ?? ""))
        .data?.kazusa.renames ?? {}
    );
  } catch {
    return {};
  }
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
  template: Tree,
  base: Tree | undefined,
  options: { readonly layout: MergePolicy["layout"] },
): Plan {
  const id = templateIdOf(live) ?? "template";
  const bestAttempt = base === undefined;
  const notInTemplate: string[] = [];
  const renames = renamesOf(template);

  const liveFiles = new Map<string, string>();
  for (const file of filesOf(live))
    liveFiles.set(renamedPath(file, renames), file);
  const baseOriginal = new Map(
    [...(base?.ids.keys() ?? [])].map((file) => [
      renamedPath(file, renames),
      file,
    ]),
  );
  const baseFiles = new Set(baseOriginal.keys());
  const templateFiles = new Set(template.ids.keys());
  const all = [
    ...new Set([...liveFiles.keys(), ...templateFiles, ...baseFiles]),
  ].sort();

  const read = (file: string) => readFileSync(file, "utf8");
  const liveText = (file: string) =>
    renamedText(read(path.join(live, liveFiles.get(file)!)), renames);
  const liveHash = (file: string) =>
    blobId(readFileSync(path.join(live, liveFiles.get(file)!)));
  const baseText = (file: string) => {
    const text = base!.text(baseOriginal.get(file)!);
    return text === undefined ? undefined : renamedText(text, renames);
  };
  const baseHash = (file: string) => base!.ids.get(baseOriginal.get(file)!);
  const templateText = (file: string) => template.text(file) ?? "";
  const templateHash = (file: string) => template.ids.get(file);

  const changes: Change[] = [];
  let keptTheirs = 0;
  let arranged = 0;
  let arrangedMoved = 0;
  const mapLine = (text: string | undefined) =>
    text === undefined ? null : (/^map:.*$/m.exec(text)?.[0] ?? null);
  for (const file of all) {
    const inL = liveFiles.has(file);
    const inT = templateFiles.has(file);
    const inB = baseFiles.has(file);
    const from =
      inL && liveFiles.get(file) !== file ? { from: liveFiles.get(file)! } : {};
    const md = file.endsWith(".md");
    if (file === PACKAGE) {
      if (!inT || !inL) continue;
      // The creator's, byte for byte, so a clone has nothing left to show as
      // changed; a world from before clones keeps which template it names.
      const current = JSON.parse(
        read(path.join(live, file)),
      ) as Partial<WorldPackage>;
      const kept = current.kazusa?.template;
      const theirs = templateText(file);
      const next = kept
        ? `${JSON.stringify(
            {
              ...(JSON.parse(theirs) as WorldPackage),
              kazusa: {
                ...(JSON.parse(theirs) as WorldPackage).kazusa,
                template: kept,
              },
            },
            null,
            2,
          )}\n`
        : theirs;
      if (next !== read(path.join(live, file)))
        changes.push({ path: file, outcome: "updated", text: next });
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
      // Arranged: the user's position isn't the base's. Moved: the creator's
      // isn't either, nor the user's, so `layout` picks between them.
      const [lm, tm, bm] = [mapLine(l), mapLine(t), mapLine(b)];
      if (PLACE.test(file) && lm && lm !== bm) {
        arranged++;
        if (tm !== bm && tm !== lm) arrangedMoved++;
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
  const inBase = characters(baseFiles);
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
    removedCharacters: [...inBase].filter(
      (who) => !after.has(who) && before.has(who),
    ),
    arranged,
    arrangedMoved,
  };
}

// --------------------------------------------------------------------- apply

export interface Report {
  readonly template: string;
  /** The commit the world stood on before, and the release it took. */
  readonly from?: string;
  readonly to: string;
  readonly version?: string;
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

function write(file: string, data: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/**
 * Writes the plan into the world's files, and the report the system agent
 * resolves from: an update stays open until `finishUpdate`.
 */
export function applyUpdate(
  live: string,
  template: Tree,
  plan: Plan,
  layout: MergePolicy["layout"],
  release: {
    readonly from?: string;
    readonly to: string;
    readonly version?: string;
  },
): Report {
  for (const change of plan.changes)
    if (change.from) rmSync(path.join(live, change.from), { force: true });
  for (const change of plan.changes)
    if (change.outcome === "removed" || change.outcome === "forgotten")
      rmSync(path.join(live, change.path), { force: true });
  template.copy(
    plan.changes
      .filter(({ copyFromTemplate }) => copyFromTemplate)
      .map(({ path: file }) => file),
    live,
  );
  for (const change of plan.changes)
    if (!change.copyFromTemplate && change.text !== undefined)
      write(path.join(live, change.path), change.text);
  const counts: Record<string, number> = {};
  for (const { outcome } of plan.changes)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  const report: Report = {
    template: plan.template,
    ...release,
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

/** The update being resolved, if one is. */
export function readReport(live: string): Report | undefined {
  const file = path.join(live, REPORT);
  if (!existsSync(file)) return undefined;
  const report = JSON.parse(readFileSync(file, "utf8")) as Report & {
    stage?: string;
  };
  // An older Kazusa's finished update left its report behind.
  return report.stage === "finished" || !report.to ? undefined : report;
}

/** Closes the update: nothing is left to resolve. */
export function finishUpdate(live: string): Report {
  const report = readReport(live);
  if (!report) throw new Error("No update to finish.");
  rmSync(path.join(live, REPORT), { force: true });
  return report;
}
