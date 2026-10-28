"use client";

import { useSyncExternalStore } from "react";
import type { DesireRecord, DesiresConfig } from "@kazusa/client";
import { desireConfigStore, desireStore } from "@/lib/live/state";

export function useDesireConfig(): DesiresConfig | null {
  return useSyncExternalStore(
    (listener) => desireConfigStore.subscribe(listener),
    () => desireConfigStore.get(),
    () => null,
  );
}

/** Per-id subscription; levels are derived from the record and `useSimNow()`. */
export function useDesireRecord(
  id: string | undefined,
): DesireRecord | undefined {
  return useSyncExternalStore(
    (listener) => (id ? desireStore.subscribeKey(id, listener) : () => {}),
    () => (id ? desireStore.get(id) : undefined),
    () => undefined,
  );
}
