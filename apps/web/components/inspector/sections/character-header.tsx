"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { chatsParsers } from "@/components/views/chats/search-params";
import { timelineParsers } from "@/components/views/timeline/search-params";
import { useState } from "react";
import {
  BookOpenIcon,
  BrainIcon,
  CircleAlertIcon,
  HistoryIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PowerIcon,
  SpeechIcon,
  SquareIcon,
  StarIcon,
} from "lucide-react";
import { CharacterBrainSheet } from "./character-brain";
import { CharacterMemorySheet } from "./character-memory";
import { RichText, usePlainText } from "@/components/views/wiki/page-link";
import { useStopBrain } from "./character-stop";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { Toolbar, type ToolbarAction } from "@/components/inspector/toolbar";
import {
  CastDialog,
  type CastRequest,
} from "@/components/views/world/cast-dialog";
import { useStage } from "@/hooks/use-stage";
import { useCharacter, useCharacterStatus } from "@/hooks/use-characters";
import { useAccess } from "@/hooks/use-access";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useChats } from "@/hooks/use-chats";
import { useDraftChat } from "@/lib/state/chat-draft";
import { useSources } from "@/lib/source/provider";
import type { EntityRef } from "@/lib/state/entity-ref";
import { toggleWatch, useWatchlist } from "@/lib/state/preferences-store";
import { cn } from "@/lib/utils";

const KIND_NOTE = { agent: undefined, npc: "NPC" } as const;

export function CharacterHeaderSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const watchlist = useWatchlist();
  const [queryState, setParams] = useQueryStates({
    view: parseAsString,
    "chats.id": chatsParsers["chats.id"],
    "chats.dm": chatsParsers["chats.dm"],
    "chats.talk": chatsParsers["chats.talk"],
    "chats.member": chatsParsers["chats.member"],
    character: parseAsString,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
  });
  const { resolved, watching, operator } = useSources();
  const { canPlay, canManage } = useAccess();
  const starred = watchlist.includes(entity.id);
  const player = usePlayer();
  const position = usePosition(entity.id);
  const standing = position?.kind === "at" ? position.placeId : undefined;
  const there = usePlace(standing);
  const status = useCharacterStatus(entity.id);
  const offstage = status?.onstage === false;
  // Yourself: nothing to message, talk to or walk over to.
  const yourself = entity.id === player.id;
  const failure = status?.brain === "thinking" ? undefined : status?.failure;
  const { available: canObserve } = useObservedChat(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [cast, setCast] = useState<CastRequest | null>(null);
  const stopper = useStopBrain(entity.id, character?.name ?? entity.id);
  const stageLive = Boolean(useStage().apply);
  const plain = usePlainText();
  // Message is redundant while their direct chat is the one open, and Talk in
  // person while you are already talking with them there.
  const view = queryState["view"];
  const openChatId = queryState["chats.id"];
  const { chats } = useChats();
  const draft = useDraftChat();
  const open =
    view === "chats"
      ? (chats.find((chat) => chat.id === openChatId) ??
        (draft?.id === openChatId ? draft : undefined))
      : undefined;
  // Your console with the system agent is not the chat the one you play has
  // with her.
  const inTheirDm =
    open?.type === "direct" &&
    open.members.includes(entity.id) &&
    open.members.includes(player.id || operator.id);
  const inTheirHuddle =
    open?.type === "huddle" && open.members.includes(entity.id);

  if (!character) {
    return (
      <p className="pr-8 text-sm text-muted-foreground">{`Unknown character "${entity.id}".`}</p>
    );
  }

  // Only the unusual kinds are worth a word; most of the roster is simulated.
  const notes = [KIND_NOTE[character.kind], offstage && "Offstage"]
    .filter(Boolean)
    .join(" · ");
  const summary = character.summary;
  // Watching, only the console is yours to write in.
  const canMessage =
    character.kind === "agent" &&
    resolved.chats === "live" &&
    !yourself &&
    (!watching || Boolean(character.isSystemAgent));
  // Face to face needs both of you standing in the same place.
  const together = standing !== undefined && standing === player.placeId;

  const isAgent = character.kind === "agent";
  const canGo = isAgent && there && !together && player.live && !yourself;
  const showBrain =
    isAgent &&
    resolved.brain === "live" &&
    (!character.isSystemAgent || canManage);
  const showChats = canMessage && canObserve;
  // A played character stays onstage until nobody plays them.
  const canStage =
    canManage &&
    isAgent &&
    !character.isSystemAgent &&
    stageLive &&
    !status?.playedBy;

  /**
   * Most used first, alike together: talking to them, going to them, stopping
   * their turn, following them, looking into them, and the cast. Each only when
   * it applies; what doesn't fit goes into More in the same order.
   */
  const actions: ToolbarAction[] = [
    ...(canMessage && !inTheirDm
      ? [
          {
            id: "message",
            group: "talk",
            label: "Message",
            icon: MessageCircleIcon,
            disabled: !canPlay,
            onSelect: () =>
              void setParams({ view: "chats", "chats.dm": character.id }),
          },
        ]
      : []),
    ...(canMessage && together && !inTheirHuddle
      ? [
          {
            id: "talk",
            group: "talk",
            label: "Talk in person",
            icon: SpeechIcon,
            disabled: !canPlay,
            onSelect: () =>
              void setParams({ view: "chats", "chats.talk": character.id }),
          },
        ]
      : canGo
        ? [
            {
              id: "go",
              group: "move",
              label: `Go to ${there.name}`,
              icon: MapPinIcon,
              disabled: !player.moveTo,
              onSelect: () => void player.moveTo?.(there.id),
            },
          ]
        : []),
    ...(stopper.shown
      ? [
          {
            id: "stop",
            group: "run",
            label: stopper.stopping ? "Stopping" : "Stop thinking",
            icon: stopper.stopping ? LoaderCircleIcon : SquareIcon,
            busy: stopper.stopping,
            disabled: stopper.stopping,
            onSelect: stopper.stop,
          },
        ]
      : []),
    {
      id: "watch",
      inMenu: true,
      group: "follow",
      label: starred ? "Unwatch" : "Watch",
      icon: StarIcon,
      pressed: starred,
      onSelect: () => toggleWatch(character.id),
    },
    {
      id: "wiki",
      inMenu: true,
      group: "look",
      label: "Wiki page",
      icon: BookOpenIcon,
      onSelect: () =>
        void setParams({ view: "characters", character: character.id }),
    },
    ...(isAgent
      ? [
          {
            id: "memory",
            group: "look",
            label: "Memory",
            icon: NotebookPenIcon,
            onSelect: () => setMemoryOpen(true),
          },
        ]
      : []),
    ...(showChats
      ? [
          {
            id: "chats",
            inMenu: true,
            group: "look",
            label: "Chats",
            icon: MessagesSquareIcon,
            onSelect: () =>
              void setParams({
                view: "chats",
                "chats.member": character.id,
                "chats.id": null,
              }),
          },
        ]
      : []),
    {
      id: "timeline",
      inMenu: true,
      group: "look",
      label: "Timeline",
      icon: HistoryIcon,
      onSelect: () =>
        void setParams({
          view: "timeline",
          "tl.actors": [character.id],
          "tl.watch": null,
        }),
    },
    ...(showBrain
      ? [
          {
            id: "brain",
            group: "look",
            label: "Brain",
            icon: BrainIcon,
            onSelect: () => setBrainOpen(true),
          },
        ]
      : []),
    ...(canStage
      ? [
          {
            id: "stage",
            group: "cast",
            label: offstage ? "Enable" : "Disable",
            icon: PowerIcon,
            onSelect: () =>
              setCast({
                label: character.name,
                cast: [character],
                intent: offstage ? "onstage" : "offstage",
              }),
          },
        ]
      : []),
  ];

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
          {summary || notes ? (
            <p
              title={[summary ? plain(summary) : "", notes]
                .filter(Boolean)
                .join(" · ")}
              className="line-clamp-2 text-sm leading-snug text-muted-foreground"
            >
              {/* Its [[links]] live, as on their page. */}
              {summary ? <RichText text={summary} /> : null}
              {summary && notes ? " · " : null}
              {notes}
            </p>
          ) : null}
        </div>
      </div>

      {failure ? <FailureLine error={failure.error} /> : null}

      {/* Pulled out by a button's padding: the first icon lines up with the
          avatar, More with the close button above it. */}
      <Toolbar
        actions={actions}
        moreLabel={`More for ${character.name}`}
        className="-mr-1 -ml-1.5"
      />

      {isAgent ? (
        <CharacterMemorySheet
          id={character.id}
          name={character.name}
          open={memoryOpen}
          onOpenChange={setMemoryOpen}
        />
      ) : null}
      <CastDialog request={cast} onOpenChange={() => setCast(null)} />
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
