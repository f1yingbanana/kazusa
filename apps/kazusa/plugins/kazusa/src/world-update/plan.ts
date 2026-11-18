import { hasPlace } from "../wiki-layout.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WorldPackageSchema } from "@kazusa/client";
import { CARD_FILES, convertPage, foldKind } from "../characters/fold.ts";
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
  let renames: Record<string, string>;
  try {
    renames =
      WorldPackageSchema.safeParse(JSON.parse(template.text(PACKAGE) ?? ""))
        .data?.kazusa.renames ?? {};
  } catch {
    return {};
  }
  // An old id the release uses again is another page now: it stays.
  const pages = new Set(
    [...template.ids.keys()]
      .map((file) => /^shared\/wiki\/(?:.+\/)?([^/]+)\.md$/.exec(file)?.[1])
      .filter((id): id is string => id !== undefined),
  );
  return Object.fromEntries(
    Object.entries(renames).filter(([from]) => !pages.has(from)),
  );
}

function renamedPath(
  file: string,
  renames: Record<string, string>,
  /**
   * In the two-folder layout places are in `concepts/`; before, a concept could
   * share a place's id.
   */
  upgraded = false,
): string {
  const match = (
    upgraded
      ? /^(.*\/wiki\/(?:entities\/places|concepts)\/)([^/]+)\.md$/
      : /^(.*\/wiki\/entities\/places\/)([^/]+)\.md$/
  ).exec(file);
  if (!match) return file;
  const to = renames[match[2]];
  return to ? `${match[1]}${to}.md` : file;
}

/** A page of the older wiki layout, World Wiki or a character's. */
const OLDER =
  /^(shared\/wiki|workspaces\/[^/]+\/wiki)\/(entities\/characters|entities\/places|entities\/concepts|groups)\/([^/]+)$/;

/**
 * Where a page of the older layout lives in the two-folder one: the cast in
 * `characters/`, everything else in `concepts/`. Ids stay the same.
 */
export function upgradedPath(file: string): string {
  const match = OLDER.exec(file);
  if (!match) return file;
  const folder = match[2] === "entities/characters" ? "characters" : "concepts";
  return `${match[1]}/${folder}/${match[3]}`;
}

/**
 * Files by where they belong in the release, each from where it is. A page
 * already where it belongs keeps its place when an older one would land there
 * too: that one stays where it is, for judgment.
 */
function mapped(
  files: Iterable<string>,
  where: (file: string) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  // Already there first, then a page that only changes folder, then a rename.
  const rank = (file: string) => {
    const at = where(file);
    return at === file ? 0 : path.basename(at) === path.basename(file) ? 1 : 2;
  };
  for (const file of [...files].sort((a, b) => rank(a) - rank(b))) {
    const at = where(file);
    out.set(out.has(at) ? file : at, file);
  }
  return out;
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

const CHARACTER = /^shared\/wiki\/(?:entities\/)?characters\/([^/]+)\.md$/;
/** A World Wiki page that can be a place, in either layout. */
const PLACE = /^shared\/wiki\/(?:entities\/places|concepts)\/([^/]+)\.md$/;
/** A character's page that can be on a place, in either layout. */
const CARD =
  /^workspaces\/[^/]+\/wiki\/(?:entities\/places|concepts)\/([^/]+)\.md$/;
/** Whether a page is a place: in the older folder, or with `place_id`. */
const isPlace = (file: string, text: string | undefined): boolean =>
  file.includes("/entities/places/") || (text !== undefined && hasPlace(text));

export function planUpdate(
  live: string,
  template: Tree,
  base: Tree,
  options: { readonly layout: MergePolicy["layout"] },
): Plan {
  const renames = renamesOf(template);
  // A release in the two-folder layout brings an older world's pages along.
  // Only the update that moves an older world: once it stands on a release in
  // the two-folder layout, its pages are already where they belong.
  const twoFolders = (tree: Tree) =>
    [...tree.ids.keys()].some((file) =>
      file.startsWith("shared/wiki/characters/"),
    );
  const upgrade = twoFolders(template) && !twoFolders(base);
  // In the two-folder layout a renamed place, or a merged concept, is in
  // `concepts/`, whether this update moves the world there or it already is.
  const inConcepts = twoFolders(template);
  const where = (file: string) =>
    renamedPath(upgrade ? upgradedPath(file) : file, renames, inConcepts);

  const liveFiles = mapped(filesOf(live), where);
  const baseOriginal = mapped(base.ids.keys(), where);
  // A release in the new layout has one page per character: a character's
  // card (IDENTITY.md, SOUL.md) folds into their World Wiki page, and every
  // page gets the front matter Kazusa reads (`characters/fold.ts`). Both sides
  // are read as that leaves them, each with its own cards, so the creator's
  // card and play's changes to it meet on the page.
  const folds = (id: string) =>
    upgrade &&
    template.ids.has(`shared/wiki/characters/${id}.md`) &&
    !CARD_FILES.some((name) => template.ids.has(`workspaces/${id}/${name}`));
  const readLive = (file: string) => {
    try {
      return readFileSync(path.join(live, file), "utf8");
    } catch {
      return undefined;
    }
  };
  const asFolded = (
    file: string,
    text: string,
    cardText: (file: string) => string | undefined,
  ): string => {
    const relative = /^shared\/wiki\/(.+\.md)$/.exec(file)?.[1];
    if (!upgrade || !relative || relative === "INDEX.md") return text;
    const kind = foldKind(relative);
    const id = path.basename(relative, ".md");
    return convertPage(
      text,
      kind,
      id,
      kind === "person" && folds(id)
        ? {
            identity: cardText(`workspaces/${id}/${CARD_FILES[0]}`),
            soul: cardText(`workspaces/${id}/${CARD_FILES[1]}`),
          }
        : undefined,
    );
  };
  /** A card the release folded into its character's page. */
  const foldedCard = (file: string): boolean => {
    const match = /^workspaces\/([^/]+)\/(IDENTITY|SOUL)\.md$/.exec(file);
    return match !== null && folds(match[1]);
  };
  const baseFiles = new Set(baseOriginal.keys());
  const templateFiles = new Set(template.ids.keys());
  const all = [
    ...new Set([...liveFiles.keys(), ...templateFiles, ...baseFiles]),
  ].sort();

  const read = (file: string) => readFileSync(file, "utf8");
  const liveText = (file: string) => {
    const original = liveFiles.get(file)!;
    return renamedText(
      asFolded(original, read(path.join(live, original)), readLive),
      renames,
    );
  };
  const liveHash = (file: string) =>
    blobId(readFileSync(path.join(live, liveFiles.get(file)!)));
  const baseText = (file: string) => {
    const original = baseOriginal.get(file)!;
    const text = base.text(original);
    return text === undefined
      ? undefined
      : renamedText(
          asFolded(original, text, (card) => base.text(card)),
          renames,
        );
  };
  const baseHash = (file: string) => base.ids.get(baseOriginal.get(file)!);
  const templateText = (file: string) => template.text(file) ?? "";
  /** A card's `name` follows its place's world page, as the release has it. */
  const cardNamed = (file: string, text: string) => {
    const id = CARD.exec(file)?.[1];
    const page =
      id &&
      (template.text(`shared/wiki/concepts/${id}.md`) ??
        template.text(`shared/wiki/entities/places/${id}.md`));
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
    if (!inT && inL && foldedCard(file)) {
      // Its words are on the character's page now.
      changes.push({ path: file, outcome: "removed", ...from });
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
  const textOf = (file: string): string | undefined =>
    liveFiles.has(file) ? liveText(file) : template.text(file);
  const places = new Set(
    [...new Set([...liveFiles.keys(), ...templateFiles])]
      .filter(
        (file) =>
          PLACE.test(file) && !removed.has(file) && isPlace(file, textOf(file)),
      )
      .map((file) => PLACE.exec(file)![1]),
  );
  /** Whether the release before this one had a place with this id. */
  const wasPlace = (id: string): boolean =>
    [
      `shared/wiki/entities/places/${id}.md`,
      `shared/wiki/concepts/${id}.md`,
    ].some((file) => baseFiles.has(file) && isPlace(file, baseText(file)));
  const planned = new Map(changes.map((change) => [change.path, change]));
  for (const file of liveFiles.keys()) {
    const card = CARD.exec(file)?.[1];
    if (!card || places.has(card) || templateFiles.has(file)) continue;
    // A page on lore, not a place: nothing to forget.
    if (!isPlace(file, liveText(file)) && !wasPlace(card)) continue;
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
            ...(wasPlace(card)
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

  // A page nothing else changes still follows a rename: a character's home,
  // a place's parent, a link in a memory.
  for (const file of liveFiles.keys()) {
    if (planned.has(file) || !file.endsWith(".md")) continue;
    const text = liveText(file);
    if (text !== read(path.join(live, liveFiles.get(file)!)))
      planned.set(file, { path: file, outcome: "updated", text });
  }

  const pendingRenames = Object.fromEntries(
    Object.entries(renames).filter(([from]) =>
      [...liveFiles.values()].some(
        (file) =>
          renamedPath(
            upgrade ? upgradedPath(file) : file,
            { [from]: renames[from] },
            inConcepts,
          ) !== (upgrade ? upgradedPath(file) : file),
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
