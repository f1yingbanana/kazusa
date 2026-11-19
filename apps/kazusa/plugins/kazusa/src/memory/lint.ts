import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { WorldModel } from "./knowledge.ts";
import type { Page } from "./page.ts";

/**
 * OpenClaw's default `bootstrapMaxChars`: a character's turn gets only this
 * much of their page, which goes in where IDENTITY.md would.
 */
export const CARD_MAX_CHARS = 20_000;
/**
 * A page past this many tokens (roughly) is long for something read in a
 * character's context, whose whole turn is 64k tokens by default.
 */
export const LONG_PAGE_TOKENS = 8_000;

/** Roughly how many tokens a page's words take, scripts weighed as models do. */
export const pageTokens = (page: Page): number =>
  estimateTokens({
    role: "user",
    content: [page.lead, ...page.sections.map((section) => section.text)].join(
      "\n\n",
    ),
    timestamp: 0,
  });

/**
 * A warning for a page too long to be read whole, if it is. `card`: a World
 * Wiki page, which is a character's own when it is a person's.
 */
function lengthWarning(page: Page, card: boolean): string | undefined {
  const tokens = pageTokens(page);
  const about = `about ${tokens.toLocaleString("en")} tokens`;
  if (
    card &&
    page.kind === "person" &&
    page.path.startsWith("characters/") &&
    page.length > CARD_MAX_CHARS
  )
    return `${page.length.toLocaleString("en")} characters (${about}): a character's turn gets only the first ${CARD_MAX_CHARS.toLocaleString("en")} of their page, so the rest never reaches them. Move what they needn't carry to linked pages.`;
  if (tokens > LONG_PAGE_TOKENS)
    return `${about}: long for a page read in a character's context. Splitting it into linked pages lets each part come up when it matters.`;
  return undefined;
}

export interface LintFinding {
  readonly level: "error" | "warning";
  /** `world/<id>` or `<agentId>/<id>`. */
  readonly page: string;
  readonly message: string;
}

export function lintWorld(world: WorldModel): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (
    level: LintFinding["level"],
    page: string,
    message: string,
  ): void => {
    findings.push({ level, page: `world/${page}`, message });
  };
  for (const page of world.pages.values()) {
    for (const problem of page.problems) add("error", page.id, problem);
    const long = lengthWarning(page, true);
    if (long) add("warning", page.id, long);
    const reference = (field: string, value: string | undefined): void => {
      if (value && !world.resolve(value))
        add("error", page.id, `\`${field}\` "${value}" resolves to no page`);
    };
    reference("parent", page.parent);
    reference("home", page.home);
    if (world.upgraded) {
      if (page.parent && !page.place)
        add(
          "warning",
          page.id,
          "`parent` is only read on a place: link to what it belongs to instead",
        );
      for (const [field, list] of [
        ["known", page.known],
        ["in", page.in],
      ] as const)
        for (const { ref } of list) {
          reference(field, ref);
          const named = world.pages.get(world.resolve(ref) ?? "");
          if (named && !named.group)
            add(
              "error",
              page.id,
              `\`${field}\` names ${named.name}, which isn't a group (\`group: true\`)`,
            );
        }
      if (page.in.length && page.kind !== "person")
        add("warning", page.id, "`in` is only read on a character's page");
      const older = page.renown
        ? "renown"
        : page.knownBy.length
          ? "known_by"
          : page.legacyGroups.length
            ? "groups"
            : undefined;
      if (older)
        add(
          "warning",
          page.id,
          `\`${older}\` is from the older format and isn't read: say who knows it in \`known\``,
        );
    }
    for (const link of page.links) {
      if (!world.resolve(link))
        add("warning", page.id, `link to unknown page "${link}"`);
    }
    for (const section of page.sections) {
      if (section.knownBy.some((who) => who !== page.id))
        add(
          "error",
          page.id,
          `"${section.title}" is \`Known by:\` someone else: only a character's own page has parts only they know; what others know goes in their own wikis`,
        );
    }
    if (
      world.upgraded &&
      page.kind === "concept" &&
      !page.known.length &&
      !page.everyone &&
      !page.group &&
      !page.place
    )
      add("warning", page.id, "nobody knows it: no `known`");
    if (!page.lead && !page.summary)
      add("warning", page.id, "no summary or lead");
  }
  if (!world.upgraded && world.pages.size)
    findings.push({
      level: "warning",
      page: "world",
      message:
        "This world is in the older format: a new release of its template can bring it into the new one",
    });
  for (const [id, first, second] of world.duplicates)
    add(
      "error",
      id,
      `two pages share this id (${first}, ${second}): one hides the other, so rename one`,
    );
  for (const [alias, owners] of world.collisions())
    add(
      "warning",
      owners[0],
      `alias "${alias}" also on ${owners.slice(1).join(", ")}`,
    );
  return findings;
}

export function lintPersonal(
  agentId: string,
  pages: Iterable<Page>,
  world: WorldModel,
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of pages) {
    const label = `${agentId}/${page.id}`;
    for (const problem of page.problems)
      findings.push({ level: "warning", page: label, message: problem });
    const long = lengthWarning(page, false);
    if (long) findings.push({ level: "warning", page: label, message: long });
    if ((page.kind === "person" || page.place) && !world.pages.has(page.id))
      findings.push({
        level: "warning",
        page: label,
        message: `no world ${page.kind} page with this id`,
      });
  }
  return findings;
}
