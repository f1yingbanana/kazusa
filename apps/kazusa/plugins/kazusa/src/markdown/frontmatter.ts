import YAML from "yaml";
import type { z } from "zod";

/**
 * Shared YAML frontmatter reader for all Kazusa Markdown documents (D4). Parses
 * frontmatter against a Zod schema and extracts the body verbatim.
 */
export function readFrontmatter<T>(
  text: string,
  schema: z.ZodType<T>,
): { data: T; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      data: schema.parse({}),
      body: text.trim(),
    };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]) ?? {};
  } catch {
    parsed = {};
  }
  const data = schema.parse(parsed);
  const body = text.slice(match[0].length).trim();
  return { data, body };
}
