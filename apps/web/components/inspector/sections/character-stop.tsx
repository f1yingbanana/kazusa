"use client";

import { useState } from "react";
import { LoaderCircleIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useCharacterStatus } from "@/hooks/use-characters";
import { abortCharacterBrain } from "@/lib/source/characters/http";
import { useSources } from "@/lib/source/provider";

export function CharacterStopButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const status = useCharacterStatus(id);
  const { resolved } = useSources();
  const { canManage } = useAccess();
  const [stopping, setStopping] = useState(false);

  if (resolved.characters !== "live" || resolved.status !== "live") return null;

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

  // Only worth a button while there is a run to stop; it stays while stopping.
  if (status?.brain !== "thinking" && !stopping) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!canManage || stopping}
      onClick={() => void stop()}
      aria-busy={stopping}
      aria-label={stopping ? `Stopping ${name}` : `Stop ${name} thinking`}
    >
      {stopping ? (
        <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
      ) : (
        <SquareIcon data-icon="inline-start" />
      )}
      {stopping ? "Stopping" : "Stop"}
    </Button>
  );
}
