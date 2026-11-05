import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import type { Perception } from "../perception/perception.ts";
import type { Stage } from "../stage/stage.ts";
import type { TaskStore } from "./types.ts";

export interface IdleSupervisorDeps {
  readonly clock: Clock;
  readonly store: TaskStore;
  readonly perception: Perception;
  readonly intervalMs?: number;
  readonly maxAgentsPerTick?: number;
  /** Shared by every registration in the process; each test gets its own. */
  readonly cell?: SupervisorCell;
  /** Offstage characters are never checked in on. */
  readonly stage?: Pick<Stage, "onstage">;
}

/**
 * Every registration starts a supervisor, so they share one tick: with a timer
 * each, idle characters got one check-in per registration.
 */
export interface SupervisorCell {
  running: boolean;
  lastTickAt: number;
}

const SHARED_SUPERVISOR = Symbol.for("kazusa.taskman.supervisor");

export function sharedSupervisorCell(): SupervisorCell {
  const scope = globalThis as { [SHARED_SUPERVISOR]?: SupervisorCell };
  return (scope[SHARED_SUPERVISOR] ??= { running: false, lastTickAt: 0 });
}

/**
 * In-process recurring supervisor that periodically discovers idle characters
 * and wakes them directly to choose an initial or replacement task.
 */
export function startIdleSupervisor(
  api: OpenClawPluginApi,
  deps: IdleSupervisorDeps,
): () => void {
  const getConfig = () => currentConfig(api);
  const intervalMs = deps.intervalMs ?? 60_000;
  const maxAgentsPerTick = deps.maxAgentsPerTick ?? 2;
  const cell = deps.cell ?? { running: false, lastTickAt: 0 };
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<void> => {
    // Another registration ticked this interval already.
    if (cell.running || Date.now() - cell.lastTickAt < intervalMs / 2) return;
    cell.running = true;
    cell.lastTickAt = Date.now();
    try {
      await deps.clock.init();
      const snapshot = deps.clock.now();
      if (snapshot.speed <= 0) return;

      const configured = [...new Set(listAgentIds(getConfig()))];
      const agentIds = deps.stage
        ? await deps.stage.onstage(configured)
        : configured;
      if (!agentIds.length) return;

      const idleCandidates: string[] = [];
      for (const agentId of agentIds) {
        try {
          const [task, brainState] = await Promise.all([
            deps.store.lookup(agentId),
            deps.perception.getBrainState(agentId),
          ]);
          // Queued items don't skip a check-in: they come along with it. A
          // failed run leaves its queue waiting, and nothing else would come.
          if (brainState.brain === "thinking") continue;
          // Skip if task is still in progress
          if (
            task &&
            Number.isFinite(Date.parse(task.endAt)) &&
            Date.parse(task.endAt) > snapshot.simTime
          ) {
            continue;
          }
          idleCandidates.push(agentId);
        } catch {
          // Ignore individual lookup failures
        }
      }

      if (!idleCandidates.length) return;

      // Sample randomly up to maxAgentsPerTick
      const shuffled = [...idleCandidates].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, maxAgentsPerTick);

      for (const agentId of selected) {
        try {
          await deps.perception.idleWake(agentId);
        } catch (err: unknown) {
          api.logger.warn(
            `Taskman supervisor failed to wake idle agent ${agentId}: ${String(err)}`,
          );
        }
      }
    } catch (err: unknown) {
      api.logger.warn(`Taskman supervisor tick error: ${String(err)}`);
    } finally {
      cell.running = false;
    }
  };

  // Allow clock and session initializers 2s to settle after gateway startup
  const initialDelay = setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }, 2_000);

  return () => {
    clearTimeout(initialDelay);
    if (timer) clearInterval(timer);
  };
}
