"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ProfileResponse } from "@kazusa/client";
import {
  PROFILE_KEY,
  fetchProfile,
  saveProfile,
} from "@/lib/source/profile/http";
import { useSources } from "@/lib/source/provider";
import { useAccess } from "@/hooks/use-access";

/** The inspector shows the same description. */
function isCharacterKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "kazusa/character";
}

/** The player's own profile. Only live. */
export function useProfile() {
  const { resolved } = useSources();
  const { mutate: mutateMatching } = useSWRConfig();
  const { canPlay } = useAccess();
  const enabled = resolved.profile === "live";

  const resource = useSWR<ProfileResponse, Error>(
    enabled ? ([PROFILE_KEY] as const) : null,
    () => fetchProfile(),
    { revalidateOnFocus: false },
  );
  const { mutate } = resource;

  /** Throws if the server refuses, so the form can stay as it is. */
  const save = useCallback(
    async (about: string): Promise<void> => {
      if (!canPlay) {
        throw new Error("You do not have permission to edit your profile.");
      }
      const saved = await saveProfile({ about });
      await mutate(saved, { revalidate: false });
      void mutateMatching(isCharacterKey);
    },
    [canPlay, mutate, mutateMatching],
  );

  return {
    enabled,
    data: resource.data,
    error: resource.error,
    save,
  };
}
