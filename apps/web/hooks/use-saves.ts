"use client";

import useSWR from "swr";
import { useAccess } from "@/hooks/use-access";

/**
 * A game save (`src/world/saves.ts` in the plugin): a commit of the whole
 * world, databases included, on its own ref.
 */
export interface GameSave {
  readonly ref: string;
  readonly commit: string;
  /** The creator's commit the world stood on. */
  readonly base: string;
  /** The player's name for it; null when they gave none. */
  readonly name: string | null;
  readonly kind: "save" | "autosave";
  /** When it was made, ISO. */
  readonly savedAt: string;
  /** The world's clock then; null when unknown. */
  readonly simTime: number | null;
  /** The world's release then. */
  readonly version: string | null;
  /** The line of the creator's history it follows (`main`). */
  readonly branch: string | null;
  /** The Kazusa that made it. */
  readonly kazusaVersion: string | null;
}

/** What runs now, which a save made with other versions may not suit. */
export interface RunningVersions {
  readonly version: string | null;
  readonly kazusaVersion: string | null;
}

/**
 * A Kazusa version without its commits past the release: `0.7.0-7-g5a32cac` is
 * 0.7.0.
 */
export const releaseOf = (version: string): string =>
  version.replace(/-\d+-g[0-9a-f]+$/, "");

/**
 * How a save differs from what runs now: a save from another Kazusa may not
 * load correctly, and one from another world version takes the world back to
 * it.
 */
export function mismatchOf(
  save: GameSave,
  current: RunningVersions | null | undefined,
): { readonly kazusa: boolean; readonly world: boolean } {
  return {
    kazusa: Boolean(
      save.kazusaVersion &&
      current?.kazusaVersion &&
      releaseOf(save.kazusaVersion) !== releaseOf(current.kazusaVersion),
    ),
    world: Boolean(
      save.version && current?.version && save.version !== current.version,
    ),
  };
}

export type SavePhase =
  | "waiting"
  | "pausing"
  | "stopping"
  | "saving"
  | "loading"
  | "starting"
  | "done"
  | "failed";

/** A save or load the owner asked for, as `scripts/dev.mjs` carries it out. */
export interface SaveRequest {
  readonly id: string;
  readonly op: "save" | "load";
  readonly name?: string;
  readonly ref?: string;
  readonly kind?: "save" | "autosave";
  readonly phase: SavePhase;
  readonly at: number;
  readonly error?: string;
  /** A load that worked but kept less of this machine than it should have. */
  readonly warnings?: readonly string[];
}

interface SavesResponse {
  readonly saves?: readonly GameSave[];
  readonly request?: SaveRequest | null;
  readonly current?: RunningVersions;
  /** Whether something can restart the Gateway (`scripts/dev.mjs`). */
  readonly supervised?: boolean;
  readonly error?: string;
}

export const isRunning = (request: SaveRequest | null | undefined): boolean =>
  Boolean(request && request.phase !== "done" && request.phase !== "failed");

const SAVES_KEY = "saves";
const RUNNING_POLL_MS = 1_000;

async function fetchSaves(): Promise<SavesResponse> {
  const response = await fetch("/saves", { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as SavesResponse;
  if (!response.ok) throw new Error(body.error ?? "Couldn't list the saves.");
  return body;
}

async function post(
  body: Record<string, string | boolean>,
): Promise<SavesResponse> {
  const response = await fetch("/saves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as SavesResponse;
  if (!response.ok) throw new Error(result.error ?? "That didn't work.");
  return result;
}

/**
 * The game's saves, and saving and loading, for whoever may change this machine
 * (the local owner). Polls while a save or load runs, so a page opened in the
 * middle of one sees it too.
 */
export function useSaves() {
  const { canMaintain } = useAccess();
  const resource = useSWR<SavesResponse, Error>(
    canMaintain ? SAVES_KEY : null,
    fetchSaves,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: (latest) =>
        isRunning(latest?.request) ? RUNNING_POLL_MS : 0,
    },
  );
  const act = async (body: Record<string, string | boolean>) => {
    const result = await post(body);
    await resource.mutate();
    return result;
  };
  return {
    enabled: canMaintain,
    saves: resource.data?.saves ?? [],
    request: resource.data?.request ?? null,
    current: resource.data?.current ?? null,
    supervised: resource.data?.supervised ?? false,
    loading: resource.isLoading,
    error: resource.error,
    refresh: () => resource.mutate(),
    save: (name: string) => act({ op: "save", ...(name ? { name } : {}) }),
    /** Into the slot kept for before a world update, named for it. */
    saveBeforeUpdate: () => act({ op: "save", beforeUpdate: true }),
    load: (ref: string) => act({ op: "load", ref }),
    remove: (ref: string) => act({ op: "delete", ref }),
  };
}
