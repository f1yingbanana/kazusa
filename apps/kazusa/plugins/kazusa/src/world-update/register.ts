import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import type { LocationService } from "../location/register.ts";
import { lintMap, loadWorld } from "../location/world.ts";
import { readWorldPackage, templateDir } from "../world/package.ts";
import {
  applyUpdate,
  BASE_DIR,
  finishUpdate,
  planUpdate,
  readReport,
  templateIdOf,
  undoUpdate,
  type Plan,
  type Report,
} from "./update.ts";

const PARAMS = z.object({
  action: z.enum(["check", "apply", "conflicts", "finish", "undo"]),
  layout: z.enum(["keep", "reset"]).default("keep"),
  rehome: z.enum(["stale", "all"]).default("stale"),
  bestAttempt: z.boolean().default(false),
});

/** Keeps a tool result readable: long lists are cut and say so. */
const capped = <T>(list: readonly T[], limit = 40) =>
  list.length > limit
    ? [...list.slice(0, limit), `…and ${list.length - limit} more`]
    : list;
const short = (text: string | undefined, limit = 400) =>
  text === undefined
    ? undefined
    : text.length > limit
      ? `${text.slice(0, limit)}…`
      : text;

/**
 * Which of the user's choices this update really needs, so the system agent
 * asks only those: framing when something is removed, renamed or contested;
 * layout when the creator moved places the user arranged.
 */
function decisions(plan: Plan, counts: Record<string, number>) {
  const framing =
    plan.bestAttempt ||
    Object.keys(plan.pendingRenames).length > 0 ||
    plan.newCharacters.length > 0 ||
    plan.removedCharacters.length > 0 ||
    ["conflict", "removed", "kept-deleted", "forgotten"].some(
      (outcome) => (counts[outcome] ?? 0) > 0,
    ) ||
    plan.changes.some(
      ({ outcome, beforeThisUpdate }) =>
        outcome === "orphaned" && !beforeThisUpdate,
    );
  const layout = plan.arrangedMoved > 0;
  const ask = [
    ...(plan.bestAttempt ? ["best attempt"] : []),
    ...(framing ? ["framing"] : []),
    ...(layout ? ["layout"] : []),
  ];
  return {
    ask,
    next: ask.length
      ? `Follow the world-update skill (skills_read it now if you haven't for this update): tell the user what this brings, ask ${ask.join(", ")} in one message, save your job file, then END YOUR TURN. Never apply in the turn you ask.`
      : "Nothing here needs the user's choices: it only adds or updates files. If the user asked for this update, tell them what it brings (from `areas`) and apply; if they didn't, ask whether to. Follow the world-update skill (skills_read it now if you haven't for this update).",
  };
}

function summary(plan: Plan, live: string, template: string) {
  const counts: Record<string, number> = {};
  for (const { outcome } of plan.changes)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  const of = (outcome: string) =>
    plan.changes
      .filter((change) => change.outcome === outcome)
      .map(({ path: file }) => file);
  return {
    template: plan.template,
    version: {
      world: readWorldPackage(live)?.version ?? null,
      template: readWorldPackage(template)?.version ?? null,
    },
    hasBase: plan.hasBase,
    ...(plan.bestAttempt
      ? {
          bestAttempt: true,
          warning:
            "No record of the version this world was made from: what play wrote is guessed from its marks. Best attempt only; it can go badly, above all if this world was never really a copy of this template.",
          overlap: plan.overlap,
          notInTemplate: capped(plan.notInTemplate),
        }
      : {}),
    counts,
    areas: plan.areas,
    keptTheirs: plan.keptTheirs,
    arrangedPlaces: plan.arranged,
    arrangedPlacesTheCreatorMoved: plan.arrangedMoved,
    renames: plan.pendingRenames,
    newCharacters: plan.newCharacters,
    removedCharacters: plan.removedCharacters,
    conflicts: capped(of("conflict")),
    orphaned: capped(
      plan.changes
        .filter(({ outcome }) => outcome === "orphaned")
        .map(({ path: file, reason }) => `${file}: ${reason ?? ""}`),
    ),
    keptDeleted: capped(of("kept-deleted")),
    forgotten: capped(of("forgotten")),
    ...decisions(plan, counts),
  };
}

function conflictView(report: Report, template: string) {
  return {
    backup: report.backup,
    files: report.conflicts.map(({ path: file, parts }) => ({
      live: file,
      template: path.join(template, file),
      base: path.join(BASE_DIR, file),
      parts: parts.map((part) => ({
        part: part.part,
        base: short(part.base),
        template: short(part.template),
        live: short(part.live),
      })),
    })),
    orphaned: report.orphaned,
    keptDeleted: report.keptDeleted,
  };
}

/**
 * `world_update`: brings the live world up to date with a newer version of its
 * template. Administrative, allowlisted for the system agent only.
 */
export function registerWorldUpdate(
  api: OpenClawPluginApi,
  deps: { readonly clock: Clock; readonly location: LocationService },
): void {
  const textResult = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
    details: value,
  });
  const paths = () => {
    const live = path.resolve(".");
    const id = templateIdOf(live);
    if (!id)
      throw new Error(
        "This isn't a world made from a template: its package.json names no kazusa.template.",
      );
    const template = templateDir(live, id);
    // An empty or half-made folder would read as the creator deleting
    // everything. Kazusa downloads the template on start (worlds made before
    // templates were repositories have none until then).
    if (!readWorldPackage(template))
      throw new Error(
        `The template ${id} isn't downloaded (no ../worlds/${id}/package.json). Kazusa downloads it when it starts: ask the user to restart Kazusa, wait for "Downloaded …'s template" in its terminal, then check again.`,
      );
    return { live, template, id };
  };
  const paused = async () => {
    await deps.clock.init();
    if (deps.clock.now().speed !== 0)
      throw new Error(
        "Pause the clock first (clock_set_speed 0): nobody may act while the world changes.",
      );
  };

  /** Re-places whoever stands at, or is travelling through, a place that's gone. */
  const repairPositions = async (rehome: "stale" | "all") => {
    const fresh = loadWorld(path.join(paths().live, "shared", "wiki"));
    if (!fresh) return { moved: [] };
    // The watcher reloads the map a moment after writes land.
    for (
      let tries = 0;
      tries < 50 &&
      deps.location.world?.map.places.size !== fresh.map.places.size;
      tries++
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    const config = currentConfig(api);
    const system = config.agents?.defaults?.systemAgent?.agentId;
    const moved: { id: string; to: string; was?: string }[] = [];
    for (const id of listAgentIds(config)) {
      const home = fresh.homes.get(id);
      if (!home || id === system) continue;
      const record = await deps.location.record(id);
      const ids = record
        ? [
            record.placeId,
            record.trip?.to,
            ...(record.trip?.legs ?? []).map((leg) => leg.placeId),
          ]
        : [];
      const stale = ids.some(
        (place) => place !== undefined && !fresh.map.places.has(place),
      );
      if (rehome === "all" || stale || !record) {
        if (record?.placeId === home && !record.trip) continue;
        await deps.location.place(id, home);
        moved.push({
          id,
          to: home,
          ...(record ? { was: record.placeId } : {}),
        });
      }
    }
    return { moved };
  };

  api.registerTool({
    name: "world_update",
    label: "World Update",
    description:
      "Bring this world up to date with a newer version of the template it came from. Read the world-update skill (skills_read) before `apply`, every update: it says what to ask the user and when to stop. `check` shows what would change (`areas` says what kind of files, `ask` which choices the user must make, `next` what to do); `apply` (clock paused) backs everything up and merges, keeping what play wrote; `conflicts` lists what both sides changed; `finish` checks the map, moves anyone left somewhere that no longer exists and records the new version; `undo` restores the backup. `layout`: keep the user's arranged map positions or reset to the creator's. `rehome`: move only stranded characters, or everyone home. `bestAttempt`: apply to a world with no record of its original version, once the user accepts the risk.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["check", "apply", "conflicts", "finish", "undo"],
        },
        layout: { type: "string", enum: ["keep", "reset"] },
        rehome: { type: "string", enum: ["stale", "all"] },
        bestAttempt: { type: "boolean" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const { action, layout, rehome, bestAttempt } = PARAMS.parse(input);
      const { live, template, id } = paths();
      if (action === "check")
        return textResult(
          summary(planUpdate(live, template, { layout }), live, template),
        );
      if (action === "conflicts") {
        const report = readReport(live);
        if (!report) return textResult({ note: "No update has been applied." });
        return textResult(conflictView(report, template));
      }
      await paused();
      if (action === "apply") {
        const pending = readReport(live);
        if (pending?.stage === "applied")
          throw new Error(
            "An applied update is waiting: `finish` it or `undo` it first.",
          );
        const plan = planUpdate(live, template, { layout });
        if (plan.bestAttempt && !bestAttempt)
          throw new Error(
            "This world has no record of the version it was made from. Warn the user that this is a best attempt that can go badly, and apply with `bestAttempt: true` only once they agree.",
          );
        // Before applying, which brings in the template's version.
        const planned = summary(plan, live, template);
        const report = applyUpdate(live, template, plan, layout);
        return textResult({
          ...planned,
          backup: report.backup,
          next: "Resolve every conflict and orphan (`conflicts` lists them) before `finish`, then check the result and tell the user what changed.",
        });
      }
      if (action === "finish") {
        const problems = lintMap(path.join(live, "shared", "wiki"));
        if (problems.length) return textResult({ finished: false, problems });
        const positions = await repairPositions(rehome);
        const report = finishUpdate(live, template, id);
        const registered = new Set(listAgentIds(currentConfig(api)));
        return textResult({
          finished: true,
          ...positions,
          unregistered: report.newCharacters.filter(
            (who) => !registered.has(who),
          ),
        });
      }
      return textResult({ restored: undoUpdate(live) });
    },
  });
}
