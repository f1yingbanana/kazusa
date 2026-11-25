"use client";

import useSWR from "swr";
import type { BridgeAccountResponse } from "@kazusa/client";
import { useAccess } from "@/hooks/use-access";
import {
  BRIDGE_ACCOUNT_KEY,
  fetchBridgeAccount,
} from "@/lib/source/bridges/http";

/**
 * The person's own Discord account, for anyone who plays. `waiting` looks again
 * every few seconds, while a code is out to be sent from Discord.
 */
export function useBridgeAccount(waiting = false) {
  const { canPlay } = useAccess();
  return useSWR<BridgeAccountResponse, Error>(
    canPlay ? ([BRIDGE_ACCOUNT_KEY] as const) : null,
    () => fetchBridgeAccount(),
    { revalidateOnFocus: true, refreshInterval: waiting ? 3_000 : 0 },
  );
}
