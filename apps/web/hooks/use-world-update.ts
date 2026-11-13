"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { useSWRConfig } from "swr";
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
