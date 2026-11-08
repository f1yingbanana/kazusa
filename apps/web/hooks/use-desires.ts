"use client";

import type { DesireRecord, DesiresConfig } from "@kazusa/client";
import { useLiveStore } from "@/lib/live/state";
import { useDesiresResource } from "@/lib/source/provider";

export function useDesireConfig(): DesiresConfig | null {
  return useDesiresResource().data?.config ?? null;
}

export function useDesireRecord(
  id: string | undefined,
): DesireRecord | undefined {
  return useLiveStore((state) => (id ? state.desires.get(id) : undefined));
}
