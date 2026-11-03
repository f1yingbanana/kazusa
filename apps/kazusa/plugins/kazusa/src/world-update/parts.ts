import YAML from "yaml";

/**
 * A Markdown page as the pieces that can change independently: each top-level
 * frontmatter key, the title, the lead, and each `##` section. Two sides that
 * differ only in wrapping or key formatting are equal (`value`).
 */
export interface Part {
  readonly key: string;
  readonly raw: string;
  /** What decides equality: parsed YAML for keys, collapsed text otherwise. */
  readonly value: string;
}

export interface Doc {
  readonly front: readonly Part[];
  readonly body: readonly Part[];
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sorted(entry)]),
    );
  return value;
}

function keyValue(raw: string): string {
  try {
    return JSON.stringify(sorted(YAML.parse(raw)));
  } catch {
    return collapse(raw);
  }
}

function frontParts(yaml: string): Part[] {
  const parts: { key: string; lines: string[] }[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key || parts.length === 0) parts.push({ key: key ?? "", lines: [] });
    parts.at(-1)!.lines.push(line);
  }
  return parts
    .map(({ key, lines }) => {
      const raw = lines.join("\n").trimEnd();
      return { key: `fm:${key}`, raw, value: keyValue(raw) };
    })
    .filter(({ raw }) => raw.trim() !== "");
}

function bodyParts(body: string): Part[] {
  const parts: Part[] = [];
  const lines = body.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index++;
  if (/^# /.test(lines[index] ?? "")) {
    parts.push({
      key: "title",
      raw: lines[index],
      value: collapse(lines[index]),
    });
    index++;
  }
  const seen = new Map<string, number>();
  let current: { key: string; lines: string[] } = { key: "lead", lines: [] };
  const close = () => {
    const raw = current.lines.join("\n").trim();
    if (raw) parts.push({ key: current.key, raw, value: collapse(raw) });
  };
  for (; index < lines.length; index++) {
    const heading = /^## (.+)$/.exec(lines[index]);
    if (heading) {
      close();
      const title = collapse(heading[1]).toLowerCase();
      const count = (seen.get(title) ?? 0) + 1;
      seen.set(title, count);
      current = {
        key: `section:${title}${count > 1 ? `#${count}` : ""}`,
        lines: [lines[index]],
      };
    } else current.lines.push(lines[index]);
  }
  close();
  return parts;
}

export function parseDoc(text: string): Doc {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { front: [], body: bodyParts(text) };
  return {
    front: frontParts(match[1]),
    body: bodyParts(text.slice(match[0].length)),
  };
}

export function renderDoc(doc: Doc): string {
  const body = doc.body.map(({ raw }) => raw).join("\n\n");
  const front = doc.front.length
    ? `---\n${doc.front.map(({ raw }) => raw).join("\n")}\n---\n${body ? "\n" : ""}`
    : "";
  return `${front}${body}\n`;
}

/** The section's lines after its heading, for line-wise unions. */
export function sectionLines(part: Part): string[] {
  return part.raw
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== "");
}

export function withLines(part: Part, lines: readonly string[]): Part {
  const heading = part.raw.split(/\r?\n/)[0];
  const raw = `${heading}\n\n${lines.join("\n")}`;
  return { key: part.key, raw, value: collapse(raw) };
}
