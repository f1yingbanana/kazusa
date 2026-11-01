import { describe, expect, it } from "vitest";
import { auditWorld } from "./audit.ts";
import { WorldModel } from "./knowledge.ts";
import { parsePage, type Page } from "./page.ts";

const person = (id: string): Page =>
  parsePage(
    `---\nname: ${id}\nhome: hall\n---\n\n# ${id}\n\nLead.`,
    `entities/characters/${id}.md`,
  );
const place = (id: string, parent?: string): Page =>
  parsePage(
    `---\nplace_id: ${id}\nname: ${id}\nsummary: A place.\n${parent ? `parent: ${parent}\n` : ""}---\n\n# ${id}\n\nLead.`,
    `entities/places/${id}.md`,
  );
const knows = (id: string): Page =>
  parsePage(
    `---\nname: ${id}\nrelation: friend\n---\n\n# ${id}\n\nLead.`,
    `entities/characters/${id}.md`,
  );

describe("auditWorld", () => {
  it("finds isolated people, separate groups and map roots", () => {
    const world = new WorldModel([
      person("ann"),
      person("bo"),
      person("cy"),
      place("hall"),
      place("room", "hall"),
    ]);
    const own: Record<string, Page[]> = { ann: [knows("bo")] };
    const audit = auditWorld(
      world,
      ["ann", "bo", "cy", "ghost", "admin"],
      (id) => new Map((own[id] ?? []).map((page) => [page.id, page])),
      "admin",
    );
    expect(audit.knowNobody).toEqual(["bo", "cy", "ghost"]);
    expect(audit.knownByNobody).toEqual(["ann", "cy", "ghost"]);
    expect(audit.socialGroups).toEqual([["ann", "bo"], ["cy"], ["ghost"]]);
    expect(audit.agentsWithoutCard).toEqual(["ghost", "admin"]);
    expect(audit.mapRoots).toEqual({ hall: 2 });
  });
});
