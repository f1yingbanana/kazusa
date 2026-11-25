"use client";

import { useMemo } from "react";
import { useCast } from "@/hooks/use-characters";
import { useOffstage } from "@/hooks/use-stage";

/** Someone who can be picked to talk with. */
export interface CastPick {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly avatarUrl?: string;
  /** Why they can't be picked, under their name. */
  readonly busy?: string;
  readonly offstage?: boolean;
}

/**
 * The cast to pick from, but those in `leaving` (yourself, who is already
 * there): onstage first, then by name.
 */
export function useCastPicks(leaving: readonly string[]): readonly CastPick[] {
  const cast = useCast();
  const offstage = useOffstage();
  const key = leaving.join(" ");
  return useMemo(() => {
    const left = new Set(key.split(" "));
    return cast
      .filter((one) => !left.has(one.id))
      .map((one): CastPick => ({
        id: one.id,
        name: one.name,
        aliases: one.aliases,
        avatarUrl: one.avatarUrl,
        offstage: offstage.has(one.id),
      }))
      .toSorted((a, b) => Number(a.offstage) - Number(b.offstage));
  }, [cast, offstage, key]);
}
