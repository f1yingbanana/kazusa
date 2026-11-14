import {
  parseDoc,
  renderDoc,
  sectionLines,
  withLines,
  type Doc,
  type Part,
} from "./parts.ts";

/** Whose file this is decides who wins a disagreement nobody needs to see. */
export type Owner = "world" | "personal";

export interface MergePolicy {
  readonly owner: Owner;
  /** Map positions the user arranged in the client: kept, or the creator's. */
  readonly layout: "keep" | "reset";
}

export interface PartConflict {
  readonly part: string;
  readonly base?: string;
  readonly template?: string;
  readonly live?: string;
}

export interface MergeResult {
  readonly text: string;
  /** Parts both sides changed differently; the live side was kept. */
  readonly conflicts: readonly PartConflict[];
  /** The live side won without asking: a character's own mind. */
  readonly keptTheirs: number;
}

/** Sections that only ever grow: dated history and a character's notes. */
const UNION = new Set(["section:notes", "section:history"]);

const same = (a?: Part, b?: Part): boolean => a?.value === b?.value;

function union(base?: Part, template?: Part, live?: Part): Part | undefined {
  if (!live) return template;
  if (!template) return live;
  const old = new Set(base ? sectionLines(base) : []);
  const mine = sectionLines(live);
  const added = sectionLines(template).filter(
    (line) => !old.has(line) && !mine.includes(line),
  );
  return added.length ? withLines(live, [...added, ...mine]) : live;
}

function mergeParts(
  base: readonly Part[],
  template: readonly Part[],
  live: readonly Part[],
  policy: MergePolicy,
  conflicts: PartConflict[],
  counts: { keptTheirs: number },
): Part[] {
  const byKey = (parts: readonly Part[]) =>
    new Map(parts.map((part) => [part.key, part]));
  const b = byKey(base);
  const t = byKey(template);
  const l = byKey(live);
  // The creator's order, with each part only play has placed after the part
  // it follows in play's version: a lead a character wrote stays the lead.
  const keys = template.map(({ key }) => key);
  let previous: string | undefined;
  for (const { key } of live) {
    if (!t.has(key))
      keys.splice(
        previous === undefined ? 0 : keys.indexOf(previous) + 1,
        0,
        key,
      );
    previous = key;
  }
  const out: Part[] = [];
  for (const key of keys) {
    const [bp, tp, lp] = [b.get(key), t.get(key), l.get(key)];
    let chosen: Part | undefined;
    if (UNION.has(key)) chosen = union(bp, tp, lp);
    else if (key === "fm:map" && policy.owner === "world")
      // A position the user never moved follows the creator's either way.
      chosen = policy.layout === "reset" || same(lp, bp) ? tp : (lp ?? tp);
    else if (key === "fm:name" && policy.owner === "personal")
      chosen = tp ?? lp;
    else if (same(lp, bp)) chosen = tp;
    else if (same(tp, bp) || same(tp, lp)) chosen = lp;
    else if (policy.owner === "personal" && key.startsWith("fm:")) {
      chosen = lp;
      counts.keptTheirs++;
    } else {
      chosen = lp ?? tp;
      conflicts.push({
        part: key,
        ...(bp ? { base: bp.raw } : {}),
        ...(tp ? { template: tp.raw } : {}),
        ...(lp ? { live: lp.raw } : {}),
      });
    }
    if (chosen) out.push(chosen);
  }
  return out;
}

/**
 * Three-way merge of one Markdown page, part by part. A part the live side
 * never changed takes the creator's version; a part only the live side changed
 * stays; a part both changed differently stays live and is reported. With no
 * base (a file both sides added), every disagreement is a conflict.
 */
export function mergeMarkdown(
  base: string | undefined,
  template: string,
  live: string,
  policy: MergePolicy,
): MergeResult {
  const empty: Doc = { front: [], body: [] };
  const [bd, td, ld] = [
    base === undefined ? empty : parseDoc(base),
    parseDoc(template),
    parseDoc(live),
  ];
  const conflicts: PartConflict[] = [];
  const counts = { keptTheirs: 0 };
  const front = mergeParts(
    bd.front,
    td.front,
    ld.front,
    policy,
    conflicts,
    counts,
  );
  const body = mergeParts(bd.body, td.body, ld.body, policy, conflicts, counts);
  return {
    text: renderDoc({ front, body }),
    conflicts,
    keptTheirs: counts.keptTheirs,
  };
}

/** Whether two pages say the same thing, ignoring wrapping and the layout. */
export function sameMarkdown(
  a: string,
  b: string,
  ignore: readonly string[] = [],
): boolean {
  const key = (text: string) => {
    const doc = parseDoc(text);
    return [...doc.front, ...doc.body]
      .filter((part) => !ignore.includes(part.key))
      .map((part) => `${part.key}=${part.value}`)
      .join("\n");
  };
  return key(a) === key(b);
}
