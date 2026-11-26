"use client";

import { useState } from "react";
import { toast } from "@/ui/toast";
import { useAccess } from "@/hooks/use-access";
import { useCharacterStatus } from "@/hooks/use-characters";
import { abortCharacterBrain } from "@/lib/source/characters/http";
import { useSources } from "@/lib/source/provider";

/**
 * Stopping a character's turn: `shown` only while there is a run to stop (and
 * while stopping it), `stop` only for the owner.
 */
export function useStopBrain(id: string, name: string) {
  const status = useCharacterStatus(id);
  const { resolved } = useSources();
  const { canManage } = useAccess();
  const [stopping, setStopping] = useState(false);
  const live = resolved.characters === "live" && resolved.status === "live";

  async function stop() {
    if (!canManage) return;
    setStopping(true);
    try {
      const result = await abortCharacterBrain(id);
      if (!result.aborted) toast.info(`No brain run was stopped for ${name}.`);
      else if (!result.drained) toast.info(`Stop requested for ${name}.`);
    } catch (error) {
      toast.error(`Couldn't stop ${name}`, {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setStopping(false);
    }
  }

  return {
    shown: live && canManage && (status?.brain === "thinking" || stopping),
    stopping,
    stop: () => void stop(),
  };
}
