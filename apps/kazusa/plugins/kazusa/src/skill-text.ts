import { readFileSync } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  createSkillLoader,
  parseSkillMarkdown,
  trackSkillCache,
  type SkillLoader,
  type SkillResolutionContext,
} from "./context-engine/skill-loader.ts";
import { currentConfig } from "./current-config.ts";
import { sharedDir } from "./shared-dir.ts";

/**
 * Wording a character reads, kept in skills rather than code, so a world, a
 * character or a translation can change it. A reference names one `## section`
 * of a skill, `kazusa-results#aloud-not-here`; code says only which, and fills
 * its `{placeholders}`.
 *
 * Each section resolves on its own along the skill precedence, so an override
 * (`<workspace>/skills/kazusa-results/SKILL.md`, or a world's `shared/skills`)
 * holds only the sections it changes. Synchronous, for tool factories; files
 * are read once until `refresh_skills`.
 */
export interface SkillText {
  (
    ref: string,
    values?: Readonly<Record<string, string | number>>,
    context?: SkillResolutionContext,
  ): string;
  /** `undefined` where no skill has the section. */
  readonly maybe: (
    ref: string,
    values?: Readonly<Record<string, string | number>>,
    context?: SkillResolutionContext,
  ) => string | undefined;
}

const SECTION = /^## +(.+?) *$/;

/** `## name` sections of a skill body, each trimmed. */
export function skillSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let name: string | undefined;
  let lines: string[] = [];
  const close = (): void => {
    if (name !== undefined) sections.set(name, lines.join("\n").trim());
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = SECTION.exec(line);
    if (heading) {
      close();
      name = heading[1];
      lines = [];
    } else lines.push(line);
  }
  close();
  return sections;
}

export function createSkillText(
  loader: Pick<SkillLoader, "getCandidateRoots">,
): SkillText {
  // Path → its sections, or null when there is no such file.
  const files = new Map<string, Map<string, string> | null>();
  trackSkillCache(() => files.clear());
  const sectionsAt = (file: string): Map<string, string> | null => {
    if (!files.has(file)) {
      let sections: Map<string, string> | null = null;
      try {
        sections = skillSections(
          parseSkillMarkdown(readFileSync(file, "utf8")).body,
        );
      } catch {
        // Not here: the next root may have it.
      }
      files.set(file, sections);
    }
    return files.get(file) ?? null;
  };
  const maybe: SkillText["maybe"] = (ref, values = {}, context) => {
    const [skill, section] = ref.split("#");
    if (!skill || !section)
      throw new Error(`Skill text needs "skill#section": ${ref}`);
    for (const root of loader.getCandidateRoots(context)) {
      const text = sectionsAt(path.join(root, skill, "SKILL.md"))?.get(section);
      if (text === undefined) continue;
      return text
        .replace(/\{(\w+)\}/g, (whole, key: string) =>
          key in values ? String(values[key]) : whole,
        )
        .trim();
    }
    return undefined;
  };
  return Object.assign(
    (
      ref: string,
      values?: Readonly<Record<string, string | number>>,
      context?: SkillResolutionContext,
    ): string => {
      const text = maybe(ref, values, context);
      if (text === undefined)
        throw new Error(`No skill has the section ${ref}`);
      return text;
    },
    { maybe },
  );
}

/** Along this Gateway's skill precedence: workspace, world, then bundled. */
export function pluginSkillText(api: OpenClawPluginApi): SkillText {
  return createSkillText(
    createSkillLoader({
      config: currentConfig(api),
      pluginRootDir: api.rootDir,
    }),
  );
}

let bundled: SkillText | undefined;
/** Kazusa's own skills alone, for code running without a Gateway. */
export function bundledSkillText(): SkillText {
  return (bundled ??= createSkillText({
    getCandidateRoots: () => [sharedDir("skills")],
  }));
}

type Schema = Record<string, unknown>;

/**
 * Keywords that only police input, which every tool parses itself: the model
 * pays for them on every call and learns nothing from them.
 */
const VALIDATION_ONLY = ["$schema", "pattern", "minLength", "maxLength"];

/**
 * A tool as `kazusa-tools` words it: its description from `## <name>`, and each
 * field's from `## <name>.<field>` (nested fields `<name>.<field>.<field>`),
 * where a skill has one. What code put in a field's description becomes
 * `{data}`. Validation-only keywords are left out of what the model reads.
 */
export function describeTool<T extends { name: string; parameters?: unknown }>(
  text: SkillText,
  tool: T,
  values: Readonly<Record<string, string | number>> = {},
  context?: SkillResolutionContext,
): T & { description: string } {
  const describe = (schema: unknown, at: string): unknown => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema))
      return schema;
    const node = schema as Schema;
    const next: Schema = Object.fromEntries(
      Object.entries(node).filter(([key]) => !VALIDATION_ONLY.includes(key)),
    );
    if (node.properties && typeof node.properties === "object")
      next.properties = Object.fromEntries(
        Object.entries(node.properties as Schema).map(([key, field]) => {
          const ref = `${at}.${key}`;
          const described = describe(field, ref) as Schema;
          const own = text.maybe(
            `kazusa-tools#${ref}`,
            {
              ...values,
              data:
                typeof described.description === "string"
                  ? described.description
                  : "",
            },
            context,
          );
          if (own !== undefined)
            return [key, { ...described, description: own }];
          const { description: _unworded, ...bare } = described;
          return [key, bare];
        }),
      );
    if (node.items) next.items = describe(node.items, at);
    for (const union of ["anyOf", "oneOf"] as const)
      if (Array.isArray(node[union]))
        next[union] = (node[union] as unknown[]).map((part) =>
          describe(part, at),
        );
    return next;
  };
  return {
    ...tool,
    description: text(`kazusa-tools#${tool.name}`, values, context),
    ...(tool.parameters === undefined
      ? {}
      : { parameters: describe(tool.parameters, tool.name) }),
  };
}
