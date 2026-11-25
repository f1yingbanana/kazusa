import { WikiIdSchema } from "@kazusa/client";

/**
 * A page's id, made from its name and never shown. Ids are file names and, for
 * characters, OpenClaw agent ids, so they stay `a-z0-9_-` and at most 64 long;
 * names can be anything. Letters with no Latin spelling (CJK, kana, Cyrillic…)
 * become a short hash of the name, so 過熱 and 过热 never meet.
 */
const MAX = 48;

/** FNV-1a, base 36: six characters that change with any change to the name. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36).padStart(6, "0").slice(-6);
}

/** The Latin part of a name: "Ōta Hina" reads "ota-hina". */
function latin(name: string, separator: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, separator)
    .slice(0, MAX)
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * An id for `name` that no page in `taken` has. Characters' ids take hyphens
 * (`airi-kurimura`), other pages underscores; `fallback` names the kind when
 * the name has no Latin letters at all ("character-k3x9a1").
 */
export function pageId(
  name: string,
  taken: ReadonlySet<string>,
  {
    separator = "_",
    fallback = "page",
  }: { separator?: "_" | "-"; fallback?: string } = {},
): string {
  const trimmed = name.trim();
  const base = latin(trimmed, separator);
  // Letters that had no Latin spelling would otherwise be dropped silently.
  const lost = /[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(trimmed);
  const stem = !base
    ? `${fallback}${separator}${hash(trimmed)}`
    : lost
      ? `${base}${separator}${hash(trimmed)}`
      : base;
  let id = stem;
  for (let n = 2; taken.has(id); n += 1) id = `${stem}${separator}${n}`;
  return id;
}

/** OpenClaw agent ids stop at 64; pages may run to 128. */
const CHARACTER_MAX = 64;
const PAGE_MAX = 128;

/** Why `id` can't be used, or undefined when it can. */
export function idProblem(
  id: string,
  taken: ReadonlySet<string>,
  { character = false }: { character?: boolean } = {},
): string | undefined {
  if (!id) return "Enter an id.";
  if (taken.has(id)) return "Another page already uses this id.";
  const max = character ? CHARACTER_MAX : PAGE_MAX;
  if (id.length > max) return `Keep it to ${max} characters.`;
  if (!WikiIdSchema.safeParse(id).success)
    return "Use lowercase a–z, digits, - or _, starting with a letter or digit.";
  return undefined;
}
