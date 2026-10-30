"use client";

import {
  MapPinIcon,
  MessageCircleIcon,
  SpeechIcon,
  StarIcon,
} from "lucide-react";
import { CharacterStopButton } from "./character-stop";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacter, useCharacterStatus } from "@/hooks/use-characters";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useNavigate } from "@/hooks/use-url-state";
import { useSources } from "@/lib/source/provider";
import type { EntityRef } from "@/lib/state/entity-ref";
import { toggleWatch, useWatchlist } from "@/lib/state/watchlist";
import { cn } from "@/lib/utils";

const KIND_NOTE = { agent: undefined, npc: "NPC", player: "Player" } as const;

export function CharacterHeaderSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const watchlist = useWatchlist();
  const navigate = useNavigate();
  const { resolved } = useSources();
  const starred = watchlist.includes(entity.id);
  const player = usePlayer();
  const position = usePosition(entity.id);
  const standing = position?.kind === "at" ? position.placeId : undefined;
  const there = usePlace(standing);
  const offstage = useCharacterStatus(entity.id)?.onstage === false;

  if (!character) {
    return (
      <p className="text-sm text-muted-foreground">{`Unknown character "${entity.id}".`}</p>
    );
  }

  // Only the unusual kinds are worth a word; most of the roster is simulated.
  const subtitle = [
    character.occupation,
    character.affiliation,
    KIND_NOTE[character.kind],
    offstage && "Offstage",
  ]
    .filter(Boolean)
    .join(" · ");
  const canMessage = character.kind === "agent" && resolved.chats === "live";
  // Face to face needs both of you standing in the same place.
  const together = standing !== undefined && standing === player.placeId;

  return (
    <div className="flex items-start gap-3">
      <PresenceAvatar
        id={character.id}
        name={character.name}
        avatarUrl={character.avatarUrl}
        kind={character.kind}
        size="lg"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2
          title={character.id}
          className="truncate text-base leading-tight font-semibold"
        >
          {character.name}
        </h2>
        {subtitle ? (
          <p className="truncate text-sm text-muted-foreground mt-0.5">
            {subtitle}
          </p>
        ) : null}
        <div className="flex shrink-0 items-center gap-1 -ml-1.5 mt-2">
          {character.kind === "agent" ? (
            <CharacterStopButton id={character.id} name={character.name} />
          ) : null}
          {canMessage && together ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      navigate({ view: "chats", "chats.talk": character.id })
                    }
                  />
                }
              >
                <SpeechIcon />
                <span className="sr-only">{`Talk to ${character.name} in person`}</span>
              </TooltipTrigger>
              <TooltipContent>Talk in person</TooltipContent>
            </Tooltip>
          ) : null}
          {character.kind === "agent" && there && !together && player.moveTo ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => void player.moveTo?.(there.id)}
                  />
                }
              >
                <MapPinIcon />
                <span className="sr-only">{`Go to ${there.name}`}</span>
              </TooltipTrigger>
              <TooltipContent>{`Go to ${there.name}`}</TooltipContent>
            </Tooltip>
          ) : null}
          {canMessage ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      navigate({ view: "chats", "chats.dm": character.id })
                    }
                  />
                }
              >
                <MessageCircleIcon />
                <span className="sr-only">{`Message ${character.name}`}</span>
              </TooltipTrigger>
              <TooltipContent>Message</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={starred}
            onClick={() => toggleWatch(character.id)}
          >
            <StarIcon className={cn(starred && "fill-current")} />
            <span className="sr-only">
              {starred ? "Remove from watchlist" : "Add to watchlist"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
