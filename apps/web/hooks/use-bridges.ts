"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { BridgesResponse } from "@kazusa/client";
import {
  BRIDGES_KEY,
  fetchBridges,
  linkBridge,
  saveBridgeToken,
} from "@/lib/source/bridges/http";
import { useAccess } from "@/hooks/use-access";

/** The Discord bridge: its connection and links. Only the owner sees it. */
export function useBridges() {
  const { canManage } = useAccess();
  const resource = useSWR<BridgesResponse, Error>(
    canManage ? ([BRIDGES_KEY] as const) : null,
    () => fetchBridges(),
    {
      revalidateOnFocus: false,
      // Connecting settles on its own; look again until it has.
      // Connecting settles on its own; connected, a permission fixed in
      // Discord shows on the server's next check (it asks every 15 s at most).
      refreshInterval: (data) =>
        data?.discord.status.state === "connecting"
          ? 2_000
          : data?.discord.status.state === "connected"
            ? 15_000
            : 0,
    },
  );
  const { mutate } = resource;

  const saveToken = useCallback(
    async (token: string | null) => {
      await mutate(await saveBridgeToken({ token }), { revalidate: false });
    },
    [mutate],
  );
  const link = useCallback(
    async (chatId: string, channelId: string | null) => {
      await mutate(await linkBridge({ chatId, channelId }), {
        revalidate: false,
      });
    },
    [mutate],
  );

  return {
    enabled: canManage,
    data: resource.data,
    error: resource.error,
    saveToken,
    link,
  };
}
