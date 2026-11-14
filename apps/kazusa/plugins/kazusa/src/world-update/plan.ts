import { readFileSync } from "node:fs";
import path from "node:path";
import { WorldPackageSchema } from "@kazusa/client";
import { renamedText } from "../location/pages.ts";
import { WORLD_PACKAGE } from "../world/package.ts";
import {
  mergeMarkdown,
  sameMarkdown,
  type MergePolicy,
  type PartConflict,
} from "./merge.ts";
import { parseDoc } from "./parts.ts";
import { blobId, filesOf, type Tree } from "./tree.ts";

/**
 * What bringing the live world up to a newer release would do, file by file,
 * changing nothing: the release is one side, the world as play left it the
 * other, and the base is the creator's commit the world stood on (`tree.ts`
 * reads both commits from git). `apply.ts` writes it.
 */

/** The world's manifest: an update brings the creator's, byte for byte. */
const PACKAGE = WORLD_PACKAGE;
const LAYOUT_KEYS = ["fm:map"];

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

export function planUpdate(
  live: string,
  template: Tree,
  base: Tree,
  options: { readonly layout: MergePolicy["layout"] },
): Plan {
  const renames = renamesOf(template);

  const liveFiles = new Map<string, string>();
  for (const file of filesOf(live))
    liveFiles.set(renamedPath(file, renames), file);
  const baseOriginal = new Map(
    [...base.ids.keys()].map((file) => [renamedPath(file, renames), file]),
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
    const text = base.text(baseOriginal.get(file)!);
    return text === undefined ? undefined : renamedText(text, renames);
  };
  const baseHash = (file: string) => base.ids.get(baseOriginal.get(file)!);
  const templateText = (file: string) => template.text(file) ?? "";
  /** A card's `name` follows its place's world page, as the release has it. */
  const cardNamed = (file: string, text: string) => {
    const id = CARD.exec(file)?.[1];
    const page = id && template.text(`shared/wiki/entities/places/${id}.md`);
    const name = page && /^name:.*$/m.exec(page)?.[0];
    return name ? text.replace(/^name:.*$/m, name) : text;
  };
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
      // The creator's, byte for byte: nothing of it is play's.
      const next = templateText(file);
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
        if (from.from)
          changes.push({
            path: file,
            outcome: "updated",
            ...from,
            text: cardNamed(file, liveText(file)),
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
      const b = inB ? baseText(file) : undefined;
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
    const b = inB ? baseHash(file) : undefined;
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
