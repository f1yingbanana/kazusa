import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { cachedStore } from "../state.ts";
import type { ActiveTask, TaskStore } from "./types.ts";

/**
 * Characters' current tasks, kept in memory. Statuses, context builds,
 * decisions, Perception and Location all read them: with 145 characters about
 * 2,500 reads a minute, each a trip through OpenClaw's shared database queue.
 * Only Taskman writes them, through a store from here.
 */
export function openTaskStore(api: OpenClawPluginApi): TaskStore {
  return cachedStore(
    "tasks",
    api.runtime.state.openKeyedStore<ActiveTask>({
      namespace: "tasks",
      retention: "retained",
    }),
    { copies: true },
  );
}
