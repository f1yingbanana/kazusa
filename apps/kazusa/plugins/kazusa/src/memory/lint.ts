import { WorldModel } from "./knowledge.ts";
import type { Page } from "./page.ts";

export interface LintFinding {
  readonly level: "error" | "warning";
  /** `world/<id>` or `<agentId>/<id>`. */
  readonly page: string;
  readonly message: string;
}

const ROOT_KINDS: ReadonlySet<Page["kind"]> = new Set(["place", "person"]);

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
    const reference = (field: string, value: string | undefined): void => {
      if (value && !world.resolve(value))
        add("error", page.id, `\`${field}\` "${value}" resolves to no page`);
    };
    reference("parent", page.parent);
    reference("community", page.community);
    reference("home", page.home);
    if (page.kind === "person") {
      for (const field of Object.keys(world.anchorFields)) {
        for (const value of page.fields[field] ?? []) reference(field, value);
      }
    }
    for (const known of Object.keys(page.knows)) reference("knows", known);
    for (const link of page.links) {
      if (!world.resolve(link))
        add("warning", page.id, `link to unknown page "${link}"`);
    }
    for (const who of [
      ...page.knownBy,
      ...page.sections.flatMap((section) => section.knownBy),
    ]) {
      if (world.pages.get(who)?.kind !== "person")
        add("error", page.id, `\`known_by\` names unknown character "${who}"`);
    }
    if (
      page.kind === "concept" &&
      !page.community &&
      !page.renown &&
      !page.knownBy.length
    )
      add("warning", page.id, "no `community` or `renown`");
    if (!page.lead && !page.summary)
      add("warning", page.id, "no summary or lead");
  }
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
    if (ROOT_KINDS.has(page.kind) && !world.pages.has(page.id))
      findings.push({
        level: "warning",
        page: label,
        message: `no world ${page.kind} page with this id`,
      });
  }
  return findings;
}
