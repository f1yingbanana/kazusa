"use client";

import { useState } from "react";
import { LoaderCircleIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacterStatus } from "@/hooks/use-characters";
import { abortCharacterBrain } from "@/lib/source/characters/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

export function CharacterStopButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const status = useCharacterStatus(id);
  const { resolved } = useSources();
  const config = useKazusaConfig();
  const [stopping, setStopping] = useState(false);

  if (resolved.characters !== "live" || resolved.status !== "live") return null;

  async function stop() {
    setStopping(true);
    try {
      const result = await abortCharacterBrain(
        config.baseUrl,
        id,
        config.token,
      );
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

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={stopping || status?.brain !== "thinking"}
            onClick={() => void stop()}
            aria-busy={stopping}
          />
        }
      >
        {stopping ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <SquareIcon />
        )}
        <span className="sr-only">
          {stopping ? `Stopping ${name}'s brain` : `Stop ${name}'s brain`}
        </span>
      </TooltipTrigger>
      <TooltipContent>{stopping ? "Stopping…" : "Stop brain"}</TooltipContent>
    </Tooltip>
  );
}
