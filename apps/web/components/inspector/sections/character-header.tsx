"use client";

import { useState } from "react";
import {
  BrainIcon,
  CircleAlertIcon,
  EllipsisIcon,
  EyeIcon,
  HistoryIcon,
  MapPinIcon,
  MessageCircleIcon,
  SpeechIcon,
  StarIcon,
} from "lucide-react";
import { CharacterBrainSheet } from "./character-brain";
import { CharacterStopButton } from "./character-stop";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacter, useCharacterStatus } from "@/hooks/use-characters";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useChats } from "@/hooks/use-chats";
import { useNavigate, useParam } from "@/hooks/use-url-state";
import { useDraftChat } from "@/lib/state/chat-draft";
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
  const status = useCharacterStatus(entity.id);
  const offstage = status?.onstage === false;
  const failure = status?.brain === "thinking" ? undefined : status?.failure;
  const { available: canObserve } = useObservedChat(null);
  const [brainOpen, setBrainOpen] = useState(false);
  // Message is redundant while their direct chat is the one open, and Talk in
  // person while you are already talking with them there.
  const view = useParam("view");
  const openChatId = useParam("chats.id");
  const { chats } = useChats();
  const draft = useDraftChat();
  const open =
    view === "chats"
      ? (chats.find((chat) => chat.id === openChatId) ??
        (draft?.id === openChatId ? draft : undefined))
      : undefined;
  const inTheirDm = open?.type === "direct" && open.members.includes(entity.id);
  const inTheirHuddle =
    open?.type === "huddle" && open.members.includes(entity.id);

  if (!character) {
    return (
      <p className="pr-8 text-sm text-muted-foreground">{`Unknown character "${entity.id}".`}</p>
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

  const isAgent = character.kind === "agent";
  const canGo = isAgent && there && !together && player.moveTo;
  const showBrain = isAgent && resolved.brain === "live";
  const showChats = canMessage && canObserve;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 pr-8">
        <PresenceAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="lg"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            title={character.id}
            className="truncate text-base leading-tight font-semibold"
          >
            {character.name}
          </h2>
          {subtitle ? (
            <p
              title={subtitle}
              className="line-clamp-2 text-sm leading-snug text-muted-foreground"
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {failure ? <FailureLine error={failure.error} /> : null}

      {/* The buttons wrap rather than push Watch and More out of the panel. */}
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {canMessage && !inTheirDm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({ view: "chats", "chats.dm": character.id })
              }
            >
              <MessageCircleIcon data-icon="inline-start" />
              Message
            </Button>
          ) : null}
          {canMessage && together && !inTheirHuddle ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({ view: "chats", "chats.talk": character.id })
              }
            >
              <SpeechIcon data-icon="inline-start" />
              Talk in person
            </Button>
          ) : canGo ? (
            <Button
              variant="outline"
              size="sm"
              title={`Go to ${there.name}`}
              onClick={() => void player.moveTo?.(there.id)}
            >
              <MapPinIcon data-icon="inline-start" />
              Go there
            </Button>
          ) : null}
          {isAgent ? (
            <CharacterStopButton id={character.id} name={character.name} />
          ) : null}
        </div>

        <span className="flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={starred}
                  onClick={() => toggleWatch(character.id)}
                />
              }
            >
              <StarIcon className={cn(starred && "fill-current")} />
              <span className="sr-only">
                {starred ? "Remove from watchlist" : "Add to watchlist"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {starred ? "On your watchlist" : "Watch"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <EllipsisIcon />
              <span className="sr-only">{`More for ${character.name}`}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {showBrain ? (
                <DropdownMenuItem onClick={() => setBrainOpen(true)}>
                  <BrainIcon />
                  Peek at brain
                </DropdownMenuItem>
              ) : null}
              {showChats ? (
                <DropdownMenuItem
                  onClick={() =>
                    navigate({
                      view: "chats",
                      "chats.member": character.id,
                      "chats.id": null,
                    })
                  }
                >
                  <EyeIcon />
                  Their chats
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() =>
                  navigate({
                    view: "timeline",
                    "tl.actors": character.id,
                    "tl.watch": null,
                  })
                }
              >
                <HistoryIcon />
                Open in Timeline
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {showBrain ? (
        <CharacterBrainSheet
          id={character.id}
          name={character.name}
          open={brainOpen}
          onOpenChange={setBrainOpen}
        />
      ) : null}
    </div>
  );
}

/**
 * A failed turn, in one line: errors can run to a paragraph of paths and hints,
 * so the whole text opens on demand.
 */
function FailureLine({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className="-mx-1 flex min-w-0 items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-destructive outline-none hover:bg-destructive/5 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span
        className={cn(
          "min-w-0 flex-1 wrap-anywhere",
          open ? "max-h-48 overflow-y-auto" : "truncate",
        )}
      >
        <span className="font-medium">Latest turn failed: </span>
        {error}
      </span>
    </button>
  );
}
