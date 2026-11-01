import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { WorldModel } from "./knowledge.ts";
import type { Page } from "./page.ts";

export interface WorldAudit {
  readonly counts: Readonly<Record<string, number>>;
  /** Registered agents with no world character card. */
  readonly agentsWithoutCard: readonly string[];
  /** Registered agents, the system agent aside, with no people pages. */
  readonly knowNobody: readonly string[];
  /** Registered agents no one else has a page on. */
  readonly knownByNobody: readonly string[];
  /** Groups of registered agents with no relationship between them. */
  readonly socialGroups: readonly (readonly string[])[];
  /** Top-level places, with how many places sit under each. */
  readonly mapRoots: Readonly<Record<string, number>>;
  /** Agents who know no places beyond their home. */
  readonly knowNoPlaces: readonly string[];
}

/** The characters written next to this workspace, registered or not. */
export function workspacesBeside(workspace: string): string[] {
  const root = path.dirname(workspace);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(root, entry.name, "IDENTITY.md")),
    )
    .map((entry) => entry.name)
    .toSorted();
}

/** What lint can't see: is the world one connected society on one map? */
export function auditWorld(
  world: WorldModel,
  agents: readonly string[],
  personal: (agentId: string) => ReadonlyMap<string, Page>,
  systemAgent?: string,
): WorldAudit {
  const pages = [...world.pages.values()];
  const counts: Record<string, number> = { agents: agents.length };
  for (const page of pages) counts[page.kind] = (counts[page.kind] ?? 0) + 1;
  const cast = agents.filter((id) => id !== systemAgent);
  const edges = new Map<string, Set<string>>(cast.map((id) => [id, new Set()]));
  const known = new Set<string>();
  const knowNobody: string[] = [];
  const knowNoPlaces: string[] = [];
  for (const id of cast) {
    const own = [...personal(id).values()];
    const people = own.filter((page) => page.kind === "person");
    if (!people.length) knowNobody.push(id);
    if (own.filter((page) => page.kind === "place").length < 2)
      knowNoPlaces.push(id);
    for (const { id: other } of people) {
      known.add(other);
      if (edges.has(other)) {
        edges.get(id)!.add(other);
        edges.get(other)!.add(id);
      }
    }
  }
  const seen = new Set<string>();
  const socialGroups: string[][] = [];
  for (const start of cast) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const queue = [start];
    while (queue.length) {
      const next = queue.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      group.push(next);
      queue.push(...edges.get(next)!);
    }
    socialGroups.push(group);
  }
  socialGroups.sort((a, b) => b.length - a.length);
  const places = pages.filter((page) => page.kind === "place");
  const mapRoots: Record<string, number> = {};
  for (const place of places) {
    let root = place;
    const passed = new Set<string>();
    while (root.parent && !passed.has(root.id)) {
      passed.add(root.id);
      const up = world.pages.get(root.parent);
      if (!up) break;
      root = up;
    }
    mapRoots[root.id] = (mapRoots[root.id] ?? 0) + 1;
  }
  return {
    counts,
    agentsWithoutCard: agents.filter(
      (id) => world.pages.get(id)?.kind !== "person",
    ),
    knowNobody,
    knownByNobody: cast.filter((id) => !known.has(id)),
    socialGroups,
    mapRoots,
    knowNoPlaces,
  };
}
