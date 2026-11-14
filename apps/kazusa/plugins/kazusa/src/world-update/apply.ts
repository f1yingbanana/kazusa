import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { MergePolicy, PartConflict } from "./merge.ts";
import type { Plan } from "./plan.ts";
import type { Tree } from "./tree.ts";

/**
 * Writing a planned update into the world, and the report the system agent
 * resolves from until it's finished. The report is opened before any file
 * changes, so an update cut short is still known (`register.ts`).
 */

/** Runtime state, beside the memory index: the update being resolved. */
const STATE_DIR = path.join(".state", "kazusa", "world-update");
const REPORT = path.join(STATE_DIR, "report.json");

export interface Report {
  /** The commit the world stood on before, and the release it takes. */
  readonly from: string;
  readonly to: string;
  readonly version: string;
  /** The save of the world as it was before (`saveRef`). */
  readonly save: string;
  readonly layout: MergePolicy["layout"];
  readonly counts: Readonly<Record<string, number>>;
  readonly conflicts: readonly {
    path: string;
    parts: readonly PartConflict[];
  }[];
  readonly orphaned: readonly { path: string; reason: string }[];
  readonly keptDeleted: readonly string[];
  readonly newCharacters: readonly string[];
  readonly removedCharacters: readonly string[];
  readonly renames: Readonly<Record<string, string>>;
}

function write(file: string, data: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/**
 * The report the system agent resolves from, written before any file changes:
 * an update is open from then until `finishUpdate`, so one cut short is still
 * known (`play` isn't on `to` yet).
 */
export function openReport(
  live: string,
  plan: Plan,
  layout: MergePolicy["layout"],
  release: Pick<Report, "from" | "to" | "version" | "save">,
): Report {
  const counts: Record<string, number> = {};
  for (const { outcome } of plan.changes)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  const report: Report = {
    ...release,
    layout,
    counts,
    conflicts: plan.changes
      .filter(({ outcome }) => outcome === "conflict")
      .map(({ path: file, conflicts }) => ({
        path: file,
        parts: conflicts ?? [],
      })),
    orphaned: plan.changes
      .filter(({ outcome }) => outcome === "orphaned")
      .map(({ path: file, reason }) => ({ path: file, reason: reason ?? "" })),
    keptDeleted: plan.changes
      .filter(({ outcome }) => outcome === "kept-deleted")
      .map(({ path: file }) => file),
    newCharacters: plan.newCharacters,
    removedCharacters: plan.removedCharacters,
    renames: plan.renames,
  };
  mkdirSync(path.join(live, STATE_DIR), { recursive: true });
  writeFileSync(
    path.join(live, REPORT),
    `${JSON.stringify(report, null, 1)}\n`,
  );
  return report;
}

/**
 * Writes the plan into the world's files: every new file first, then what goes,
 * so nothing is ever only in the save.
 */
export function applyUpdate(live: string, template: Tree, plan: Plan): void {
  const kept = new Set(
    plan.changes
      .filter(({ outcome }) => outcome !== "removed" && outcome !== "forgotten")
      .map(({ path: file }) => file),
  );
  // An orphan the creator renamed moves to its new name as it is.
  for (const change of plan.changes)
    if (
      change.from &&
      kept.has(change.path) &&
      !change.copyFromTemplate &&
      change.text === undefined
    ) {
      mkdirSync(path.dirname(path.join(live, change.path)), {
        recursive: true,
      });
      renameSync(path.join(live, change.from), path.join(live, change.path));
    }
  template.copy(
    plan.changes
      .filter(({ copyFromTemplate }) => copyFromTemplate)
      .map(({ path: file }) => file),
    live,
  );
  for (const change of plan.changes)
    if (!change.copyFromTemplate && change.text !== undefined)
      write(path.join(live, change.path), change.text);
  for (const change of plan.changes) {
    if (change.from && !kept.has(change.from))
      rmSync(path.join(live, change.from), { force: true });
    if (!kept.has(change.path))
      rmSync(path.join(live, change.path), { force: true });
  }
}

/** The update being resolved, if one is. */
export function readReport(live: string): Report | undefined {
  const file = path.join(live, REPORT);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Report;
}

/** Closes the update: nothing is left to resolve. */
export function finishUpdate(live: string): Report {
  const report = readReport(live);
  if (!report) throw new Error("No update to finish.");
  rmSync(path.join(live, REPORT), { force: true });
  return report;
}
