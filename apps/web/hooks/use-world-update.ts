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
  const { canManage } = useAccess();
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
    canAsk: canManage,
    asking,
    ask,
  };
}

/** What `GET /update/world` answers: a check of the template's repository. */
export interface WorldCheck {
  /** When it was checked, in real time. */
  readonly at?: number;
  readonly checked?: boolean;
  /** A new version (or any new commit) came down. */
  readonly moved?: boolean;
  /** Problems, such as a template that couldn't be reached. */
  readonly lines?: readonly string[];
  /** Not checked: it's downloading already, or an update is half done. */
  readonly held?: "downloading" | "updating";
  /** Still going: a new version is downloading, with a progress bar. */
  readonly checking?: boolean;
}

const WORLD_CHECK_KEY = "update/world";
/** Like Kazusa's own releases (`useAnnouncedRelease`). */
const BACKGROUND_CHECK_MS = 60 * 60_000;

async function fetchWorldCheck(fresh: boolean): Promise<WorldCheck> {
  const response = await fetch(
    fresh ? "/update/world?fresh=1" : "/update/world",
    {
      cache: "no-store",
    },
  );
  const body = (await response.json().catch(() => ({}))) as WorldCheck & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? "Couldn't check for a new version.");
  return body;
}

/**
 * Checks the world's template for a new version while Kazusa runs, as starting
 * does: hourly in the background, or now from Settings. A new version downloads
 * at once, and the world's metadata is fetched again when it's in. Local owner
 * only: the download lands on this machine.
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
      refreshInterval: BACKGROUND_CHECK_MS,
      onSuccess: (result) => {
        if (result.moved) void worldResource.mutate();
      },
    },
  );
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const result = await resource.mutate(fetchWorldCheck(true), {
        revalidate: false,
      });
      if (result?.moved) await worldResource.mutate();
    } finally {
      setChecking(false);
    }
  }

  return {
    enabled,
    result: resource.data,
    error: resource.error,
    /** A check asked for now; a download it starts shows its own progress. */
    checking,
    check,
  };
}
