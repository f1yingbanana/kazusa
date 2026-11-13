"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { WorldMeta } from "@kazusa/client";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { chatsKey } from "@/lib/source/chats/cache";
import { sendMessage } from "@/lib/source/chats/http";
import { useSources } from "@/lib/source/provider";

/**
 * A newer version of the world's template, downloaded by Kazusa on start, and
 * asking the system agent to bring it in. Updating is theirs (`world_update`
 * and the `world-update` skill): it settles choices with the player and
 * resolves what doesn't merge, so the client only starts the conversation.
 */
export function useWorldUpdate(): {
  readonly update: WorldMeta["update"];
  /** The system agent's name, as the roster shows it. */
  readonly admin: string;
  /** Whether the system agent's name has loaded. */
  readonly known: boolean;
  readonly canAsk: boolean;
  readonly asking: boolean;
  readonly ask: () => Promise<void>;
} {
  const { world } = useSources();
  const update = world?.update;
  const { characters } = useCharacters();
  const character = update
    ? characters.find(({ id }) => id === update.systemAgent)
    : characters.find(({ isSystemAgent }) => isSystemAgent);
  const admin = character?.name ?? "your admin";
  const { isOwner, isLocal } = useAccess();
  const { mutate } = useSWRConfig();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chats.dm": parseAsString,
  });
  const [asking, setAsking] = useState(false);

  async function ask() {
    if (!update) return;
    setAsking(true);
    try {
      await sendMessage({
        requestId: crypto.randomUUID(),
        members: [update.systemAgent],
        text: `${world?.package?.name ?? "The world"} ${update.version} is out. Could you update our world to it?`,
      });
      await mutate(chatsKey());
      await setParams({ view: "chats", "chats.dm": update.systemAgent });
    } finally {
      setAsking(false);
    }
  }

  return {
    update,
    admin,
    known: Boolean(character),
    // Whoever may change this machine, as for Kazusa's own updates.
    canAsk: isOwner && isLocal,
    asking,
    ask,
  };
}

/** What `GET /update/world` answers: the newest release, downloading nothing. */
export interface WorldCheck {
  /** When it was checked, in real time. */
  readonly at?: number;
  readonly checked?: boolean;
  /** This world's version and the newest release's. */
  readonly current?: string;
  readonly latest?: string | null;
  readonly newer?: boolean;
  /**
   * What the newest release changes in this world, by kind of file. No files:
   * nothing for this game (a new chapter, say). Null: unknown, since this world
   * matches no release.
   */
  readonly changes?: {
    readonly files: number;
    readonly areas: readonly { area: string; count: number }[];
  } | null;
  /** Bytes to download, on GitHub. */
  readonly size?: number;
  /** In the template's clone already, ready for the system agent. */
  readonly downloaded?: boolean;
  readonly downloading?: boolean;
  readonly lastDownload?: { at: number; error?: string };
}

/** A release the player could download: newer, and with something for them. */
export function offered(check: WorldCheck | undefined): boolean {
  return Boolean(
    check?.newer && check.changes?.files !== 0 && !check.downloaded,
  );
}

const WORLD_CHECK_KEY = "update/world";
/** Like Kazusa's own releases (`useAnnouncedRelease`). */
const BACKGROUND_CHECK_MS = 60 * 60_000;
const DOWNLOADING_CHECK_MS = 2_000;

async function fetchWorldCheck(fresh: boolean): Promise<WorldCheck> {
  const response = await fetch(
    fresh ? "/update/world?fresh=1" : "/update/world",
    { cache: "no-store" },
  );
  const body = (await response.json().catch(() => ({}))) as WorldCheck & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? "Couldn't check for a new version.");
  return body;
}

/**
 * Whether the world in play has a newer release, what it changes and how big it
 * is, checked hourly like Kazusa's own and nothing downloaded; then the
 * download, once the player says so. Only for whoever may change this machine
 * (the local owner): nobody else is asked or told.
 */
export function useWorldCheck() {
  const { isOwner, isLocal } = useAccess();
  const { world, worldResource } = useSources();
  const enabled = isOwner && isLocal && Boolean(world?.package);
  const resource = useSWR<WorldCheck, Error>(
    enabled ? WORLD_CHECK_KEY : null,
    () => fetchWorldCheck(false),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      refreshInterval: (latest) =>
        latest?.downloading ? DOWNLOADING_CHECK_MS : BACKGROUND_CHECK_MS,
      // Downloaded: the world says so too, and offers the system agent.
      onSuccess: (result) => {
        if (result.downloaded) void worldResource.mutate();
      },
    },
  );
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      await resource.mutate(fetchWorldCheck(true), { revalidate: false });
    } finally {
      setChecking(false);
    }
  }

  async function download() {
    const response = await fetch("/update/world", { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Couldn't start the download.");
    }
    await resource.mutate();
  }

  return {
    enabled,
    result: resource.data,
    error: resource.error,
    checking,
    check,
    download,
  };
}
