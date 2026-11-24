"use client";

import useSWR from "swr";
import {
  isRunning,
  type GameSave,
  type RunningVersions,
  type SaveRequest,
} from "@kazusa/client";
import { useAccess } from "@/hooks/use-access";

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

interface SavesResponse {
  readonly saves?: readonly GameSave[];
  readonly request?: SaveRequest | null;
  readonly current?: RunningVersions;
  /** Whether something can restart the Gateway (`scripts/dev.mjs`). */
  readonly supervised?: boolean;
  readonly error?: string;
}

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
