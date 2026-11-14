import { readFileSync } from "node:fs";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import type { LocationService } from "../location/register.ts";
import { lintMap, loadWorld } from "../location/world.ts";
import { readWorldPackage } from "../world/package.ts";
import { text, type Git } from "../world/git.ts";
import {
  commitOf,
  downloadedRelease,
  PLAY,
  restoreWorld,
  saveRef,
  saveWorld,
  standOn,
  versionOf,
  worldGit,
} from "../world/repo.ts";
import {
  applyUpdate,
  finishUpdate,
  openReport,
  readReport,
  type Report,
} from "./apply.ts";
import { planUpdate, type Plan } from "./plan.ts";
import { blobId, commitTree } from "./tree.ts";

const ACTIONS = [
  "check",
  "apply",
  "conflicts",
  "show",
  "restore",
  "finish",
] as const;

const PARAMS = z.object({
  action: z.enum(ACTIONS),
  layout: z.enum(["keep", "reset"]).default("keep"),
  rehome: z.enum(["stale", "all"]).default("stale"),
  path: z.string().optional(),
  version: z.enum(["new", "old"]).default("new"),
});

/** Keeps a tool result readable: long lists are cut and say so. */
const capped = <T>(list: readonly T[], limit = 40) =>
  list.length > limit
    ? [...list.slice(0, limit), `…and ${list.length - limit} more`]
    : list;
const short = (value: string | undefined, limit = 400) =>
  value === undefined
    ? undefined
    : value.length > limit
      ? `${value.slice(0, limit)}…`
      : value;

/**
 * Which of the user's choices this update really needs, so the system agent
 * asks only those: framing when something is removed, renamed or contested;
 * layout when the creator moved places the user arranged.
 */
function decisions(plan: Plan, counts: Record<string, number>) {
  const framing =
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
  const ask = [...(framing ? ["framing"] : []), ...(layout ? ["layout"] : [])];
  return {
    ask,
    next: ask.length
      ? `Follow the world-update skill (skills_read it now if you haven't for this update): tell the user what this brings, ask ${ask.join(", ")} in one message, save your job file, then END YOUR TURN. Never apply in the turn you ask.`
      : "Nothing here needs the user's choices: it only adds or updates files. If the user asked for this update, tell them what it brings (from `areas`) and apply; if they didn't, ask whether to. Follow the world-update skill (skills_read it now if you haven't for this update).",
  };
}

function summary(
  plan: Plan,
  versions: {
    readonly world?: string;
    readonly template: string;
    readonly notes?: string;
  },
) {
  const counts: Record<string, number> = {};
  for (const { outcome } of plan.changes)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  const of = (outcome: string) =>
    plan.changes
      .filter((change) => change.outcome === outcome)
      .map(({ path: file }) => file);
  return {
    version: versions,
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

/**
 * What `apply` left to resolve, each file marked by whether it has been edited
 * since: the parts listed are as they were at `apply`.
 */
function conflictView(world: string, report: Report) {
  const current = (file: string) => {
    try {
      return blobId(readFileSync(path.join(world, file)));
    } catch {
      return undefined;
    }
  };
  return {
    files: report.conflicts.map(({ path: file, parts, written }) => ({
      path: file,
      editedSinceApply: current(file) !== written,
      parts: parts.map((part) => ({
        part: part.part,
        base: short(part.base),
        template: short(part.template),
        live: short(part.live),
      })),
    })),
    orphaned: report.orphaned.map((orphan) => ({
      ...orphan,
      stillThere: current(orphan.path) !== undefined,
    })),
    keptDeleted: report.keptDeleted,
    note: "The parts are as `apply` found them; `editedSinceApply` says whether you've changed the file since, `stillThere` whether an orphan is. Read a file's other versions in full with `show` (`version`: new or old).",
  };
}

/** "0.4.0" or "c8d1a1d, 2026-11-13": a commit as the user would know it. */
function label(git: Git, commit: string, version?: string): string {
  if (version) return version;
  const date = text(git, ["log", "-1", "--format=%cI", commit]).slice(0, 10);
  return `${commit.slice(0, 7)}, ${date}`;
}

/**
 * `world_update`: brings the live world up to the release the player
 * downloaded. Administrative, allowlisted for the system agent only.
 */
export function registerWorldUpdate(
  api: OpenClawPluginApi,
  deps: { readonly clock: Clock; readonly location: LocationService },
): void {
  const textResult = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
    details: value,
  });
  const live = () => path.resolve(".");
  const repo = (): Git => {
    const git = worldGit(live());
    if (!git)
      throw new Error(
        "This world isn't a git clone, so it can't take updates. If Kazusa says git is missing, the user needs to install it.",
      );
    return git;
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
    const fresh = loadWorld(path.join(path.resolve("."), "shared", "wiki"));
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
      "Bring this world up to the newer release of its world the user downloaded (Settings → Updates → World). Read the world-update skill (skills_read) before `apply`, every update: it says what to ask the user and when to stop. `check` shows what the release would change (`areas` says what kind of files, `ask` which choices the user must make, `next` what to do; `version.notes` is the creator's release notes); `apply` (clock paused) saves the world as it is, then merges the release in, keeping what play wrote; `conflicts` lists what both sides changed; `show` reads a file as the new release has it or as the world's old version had it (`version`: new or old); `restore` (clock paused) puts the world back exactly as that save kept it and closes the update, for an `apply` cut short or an update the user wants abandoned; `finish` checks the map, moves anyone left somewhere that no longer exists and closes the update. Once finished there is no undo. `layout`: keep the user's arranged map positions or reset to the creator's. `rehome`: move only stranded characters, or everyone home.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        layout: { type: "string", enum: ["keep", "reset"] },
        rehome: { type: "string", enum: ["stale", "all"] },
        path: { type: "string" },
        version: { type: "string", enum: ["new", "old"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const params = PARAMS.parse(input);
      const { action, layout, rehome } = params;
      const world = live();
      const git = repo();
      const open = readReport(world);
      // `apply` moves `play` last: short of that, it was cut off part way.
      const cutShort = open && commitOf(git, PLAY) !== open.to;
      const restoreFirst =
        "The last `apply` was cut short, so the world is half updated. `restore` it, then `check` and `apply` again.";
      const release = downloadedRelease(git);
      if (action === "show") {
        if (!params.path) throw new Error("`show` needs a `path`.");
        const commit =
          params.version === "old"
            ? (open?.from ?? commitOf(git, PLAY))
            : (open?.to ?? release?.commit);
        if (!commit)
          return textResult({
            note: `There's no ${params.version} version to show.`,
          });
        try {
          return textResult({
            path: params.path,
            version: params.version,
            text: git(["show", `${commit}:${params.path}`]).toString("utf8"),
          });
        } catch {
          return textResult({
            path: params.path,
            note: `The ${params.version} version has no such file.`,
          });
        }
      }
      if (action === "conflicts") {
        if (!open) return textResult({ note: "No update is open." });
        if (cutShort) throw new Error(restoreFirst);
        return textResult(conflictView(world, open));
      }
      if (action === "restore") {
        await paused();
        if (!open) throw new Error("No update is open to restore.");
        const back = Object.fromEntries(
          Object.entries(open.renames).map(([from, to]) => [to, from]),
        );
        const cancel = deps.location.expectRenames(back);
        try {
          restoreWorld(git, open.save, open.to);
        } catch (error) {
          cancel();
          throw error;
        }
        finishUpdate(world);
        return textResult({
          restored: true,
          version: label(git, open.from, versionOf(git)),
          next: "The world is exactly as it was before this update. If the user still wants it, `check` and `apply` again.",
        });
      }
      if (action === "finish") {
        await paused();
        if (!open) throw new Error("No update is open to finish.");
        if (cutShort) throw new Error(restoreFirst);
        const problems = lintMap(path.join(world, "shared", "wiki"));
        if (problems.length) return textResult({ finished: false, problems });
        const positions = await repairPositions(rehome);
        const report = finishUpdate(world);
        const registered = new Set(listAgentIds(currentConfig(api)));
        return textResult({
          finished: true,
          version: report.version,
          saved: report.save,
          note: "The update is closed and there's no restore from here. The save stays in the world's history for good; nothing ever closes it.",
          ...positions,
          unregistered: report.newCharacters.filter(
            (who) => !registered.has(who),
          ),
        });
      }
      if (cutShort) throw new Error(restoreFirst);
      if (open)
        throw new Error(
          "An update is open: resolve what `conflicts` lists, then `finish` it (or `restore` to abandon it).",
        );
      const base = commitOf(git, PLAY);
      if (!base)
        throw new Error("This world isn't standing on a release of its own.");
      if (!release)
        return textResult({
          upToDate: true,
          version: { world: label(git, base, versionOf(git)) },
          note: "No newer release is downloaded. If the user expects one, they can download it in Settings → Updates → World.",
        });
      const template = commitTree(git, release.commit);
      const versions = {
        world: label(git, base, versionOf(git)),
        template: label(git, release.commit, release.version),
        ...(release.notes ? { notes: release.notes } : {}),
      };
      const plan = planUpdate(world, template, commitTree(git, base), {
        layout,
      });
      if (action === "check") return textResult(summary(plan, versions));
      await paused();
      const planned = summary(plan, versions);
      const pkg = readWorldPackage(world);
      const save = saveRef(release.version);
      saveWorld(
        git,
        world,
        save,
        `${pkg?.displayName ?? pkg?.name ?? "World"} before updating to ${release.version}`,
      );
      openReport(world, plan, layout, {
        from: base,
        to: release.commit,
        version: release.version,
        save,
      });
      // Files moving under a renamed id are a rename, not a place removed:
      // whoever is there follows it.
      const cancel = deps.location.expectRenames(plan.pendingRenames);
      try {
        applyUpdate(world, template, plan);
      } catch (error) {
        cancel();
        throw error;
      }
      standOn(git, release.commit);
      return textResult({
        ...planned,
        saved: save,
        next: "Resolve every conflict and orphan (`conflicts` lists them) before `finish`, then check the result and tell the user what changed. If anything went wrong, `restore` puts the world back as it was.",
      });
    },
  });
}
