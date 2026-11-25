"use client";

import {
  BookOpenIcon,
  BrainIcon,
  CircleAlertIcon,
  EllipsisIcon,
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
import { parseAsString, useQueryStates } from "nuqs";
import { useState, type ComponentType } from "react";
import { useAccess } from "@/hooks/use-access";
import { usePageName } from "@/hooks/use-wiki";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useRunsOnModel } from "@/hooks/use-models";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useStage } from "@/hooks/use-stage";
import { useDraftChat } from "@/lib/state/chat-draft";
import { firstName } from "@/lib/format";
import { entityRefParser, type EntityRef } from "@/lib/state/entity-ref";
import { toggleWatch, useWatchlist } from "@/lib/state/preferences-store";
import { useSources } from "@/lib/source/provider";
import { Button, IconButton } from "@/ui/button";
import {
  Detail,
  DetailAbout,
  DetailActions,
  DetailActionsEnd,
  DetailHeader,
} from "@/ui/detail";
import { Fold, Folds } from "@/ui/fold";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";
import { Note } from "@/ui/note";
import {
  CastDialog,
  type CastRequest,
  CharacterBrainSheet,
  CharacterContextSection,
  CharacterContextSummary,
  CharacterMemorySheet,
  CharacterModelSection,
  CharacterModelSummary,
  CharacterRecentSection,
  CharacterRecentSummary,
  CharacterStatesSection,
  CharacterStatesSummary,
  chatsParsers,
  useStopBrain,
  useWorldNow,
  wikiParsers,
} from "../legacy";
import { conversationParsers } from "../chats/open";
import { timelineParsers } from "../timeline/search-params";
import { CharacterAvatar } from "./character-avatar";
import { Desires } from "./desires";
import { PRESENCE_TEXT, usePresence } from "./presence";
import { RightNow } from "./right-now";

type FoldSpec = {
  value: string;
  title: string;
  Section: ComponentType<{ entity: EntityRef }>;
  Summary: ComponentType<{ entity: EntityRef }>;
};

/**
 * Read in the order a watcher asks: who is this, what can I do, where are they
 * and with whom, how do they feel. Actions keep the old inspector's rank (talk,
 * go, stop, then look) with the rarely used ones in More. Play-as is left out
 * on purpose: it lives in the roster, not on every character.
 */
export function CharacterDetail({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const isAgent = character?.kind === "agent";
  const { status, presence } = usePresence({ id, kind: character?.kind });
  const { rooms } = useWorldNow();
  const { canPlay, canManage, hasPermission } = useAccess();
  const { resolved, watching, operator } = useSources();
  const player = usePlayer();
  const position = usePosition(id);
  const standing = position?.kind === "at" ? position.placeId : undefined;
  const there = usePlace(standing);
  const runsOnModel = useRunsOnModel({ id });
  const watchlist = useWatchlist();
  const pageName = usePageName();
  const stopper = useStopBrain(id, character?.name ?? id);
  const stageLive = Boolean(useStage().apply);
  const { available: canObserve } = useObservedChat(null);
  const { chats } = useChats();
  const draft = useDraftChat();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [cast, setCast] = useState<CastRequest | null>(null);
  const [params, setParams] = useQueryStates({
    view: parseAsString,
    sel: entityRefParser,
    "chats.id": chatsParsers["chats.id"],
    "chats.dm": chatsParsers["chats.dm"],
    "world.talk": conversationParsers["world.talk"],
    "world.with": conversationParsers["world.with"],
    "chats.member": chatsParsers["chats.member"],
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
    "wiki.page": wikiParsers["wiki.page"],
    "wiki.agent": wikiParsers["wiki.agent"],
    "wiki.part": wikiParsers["wiki.part"],
    "wiki.edit": wikiParsers["wiki.edit"],
    "wiki.raw": wikiParsers["wiki.raw"],
  });

  if (!character)
    return <Note inset="panel">{`Nobody called "${id}" here.`}</Note>;

  const entity: EntityRef = { kind: "character", id };
  const room = rooms.find((r) => r.members.some((m) => m.id === id));
  const company = room?.members.filter((m) => m.id !== id) ?? [];
  const called = firstName(character.name);
  const yourself = id === player.id;
  const offstage = status?.onstage === false;
  const failure = status?.brain === "thinking" ? undefined : status?.failure;
  const starred = watchlist.includes(id);

  const openId =
    params.view === "chats"
      ? params["chats.id"]
      : params.view === "world"
        ? params["world.talk"]
        : null;
  const open = openId
    ? (chats.find((c) => c.id === openId) ??
      (draft?.id === openId ? draft : undefined))
    : undefined;
  const inTheirDm =
    open?.type === "direct" &&
    open.members.includes(id) &&
    open.members.includes(player.id || operator.id);
  const inTheirHuddle = open?.type === "huddle" && open.members.includes(id);

  const canMessage =
    isAgent &&
    resolved.chats === "live" &&
    !yourself &&
    (!watching || Boolean(character.isSystemAgent));
  const together = standing !== undefined && standing === player.placeId;
  const canTalk = canMessage && together && !inTheirHuddle;
  const canGo = isAgent && there && !together && player.live && !yourself;
  const showBrain =
    isAgent &&
    resolved.brain === "live" &&
    (!character.isSystemAgent || canManage);
  const showChats = canMessage && canObserve;
  const canStage =
    canManage &&
    isAgent &&
    !character.isSystemAgent &&
    stageLive &&
    !status?.playedBy;

  const folds: FoldSpec[] = [
    {
      value: "states",
      title: "States",
      Section: CharacterStatesSection,
      Summary: CharacterStatesSummary,
    },
    {
      value: "recent",
      title: "Recent",
      Section: CharacterRecentSection,
      Summary: CharacterRecentSummary,
    },
    ...(hasPermission("manage") && runsOnModel
      ? [
          {
            value: "model",
            title: "Model",
            Section: CharacterModelSection,
            Summary: CharacterModelSummary,
          },
          {
            value: "context",
            title: "Context",
            Section: CharacterContextSection,
            Summary: CharacterContextSummary,
          },
        ]
      : []),
  ];

  const statusLine = [
    PRESENCE_TEXT[presence] || "Not simulated",
    character.kind === "npc" ? "NPC" : null,
    character.groups?.length ? pageName(character.groups[0]) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Detail label={character.name}>
      <DetailHeader
        media={
          <CharacterAvatar
            id={character.id}
            name={character.name}
            avatarUrl={character.avatarUrl}
            kind={character.kind}
          />
        }
        title={character.name}
        subtitle={
          <span
            className="group/status flex min-w-0 items-center gap-1.5"
            data-presence={presence}
          >
            <span
              className="size-2 shrink-0 rounded-full bg-ui-accent group-data-[presence=offstage]/status:bg-ui-soft group-data-[presence=offstage]/status:opacity-50 group-data-[presence=unknown]/status:bg-ui-soft group-data-[presence=unknown]/status:opacity-50 group-data-[presence=composing]/status:motion-safe:animate-ui-blink group-data-[presence=thinking]/status:motion-safe:animate-ui-blink"
              aria-hidden="true"
            />
            <span className="truncate">{statusLine}</span>
          </span>
        }
        onClose={onClose}
      />

      {failure ? <FailureLine error={failure.error} /> : null}

      <DetailActions label={`Actions for ${called}`}>
        {canMessage && !inTheirDm ? (
          <Button
            tone="primary"
            icon={<MessageCircleIcon aria-hidden />}
            disabled={!canPlay}
            onClick={() => void setParams({ view: "chats", "chats.dm": id })}
          >
            Message
          </Button>
        ) : null}
        {canTalk ? (
          <Button
            collapse
            title="Talk in person"
            icon={<SpeechIcon aria-hidden />}
            disabled={!canPlay}
            onClick={() => void setParams({ view: "world", "world.with": id })}
          >
            Talk in person
          </Button>
        ) : canGo ? (
          <Button
            collapse
            title={`Go to ${there.name}`}
            aria-label={`Go to ${there.name}`}
            icon={<MapPinIcon aria-hidden />}
            disabled={!player.moveTo}
            onClick={() => void player.moveTo?.(there.id)}
          >
            Go there
          </Button>
        ) : null}
        {stopper.shown ? (
          <Button
            collapse
            title={stopper.stopping ? "Stopping" : "Stop"}
            icon={
              stopper.stopping ? (
                <LoaderCircleIcon
                  aria-hidden
                  className="motion-safe:animate-ui-spin"
                />
              ) : (
                <SquareIcon aria-hidden />
              )
            }
            disabled={stopper.stopping}
            onClick={stopper.stop}
          >
            {stopper.stopping ? "Stopping" : "Stop"}
          </Button>
        ) : null}

        <DetailActionsEnd>
          {isAgent ? (
            <IconButton
              label="Memory"
              tone="soft"
              size="md"
              onClick={() => setMemoryOpen(true)}
            >
              <NotebookPenIcon aria-hidden />
            </IconButton>
          ) : null}
          {showBrain ? (
            <IconButton
              label="Brain"
              tone="soft"
              size="md"
              onClick={() => setBrainOpen(true)}
            >
              <BrainIcon aria-hidden />
            </IconButton>
          ) : null}
          <Menu>
            <MenuTrigger
              render={
                <IconButton
                  label={`More for ${character.name}`}
                  title="More"
                  tone="soft"
                  size="md"
                />
              }
            >
              <EllipsisIcon aria-hidden />
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                icon={
                  <StarIcon aria-hidden data-on={starred ? "" : undefined} />
                }
                onSelect={() => toggleWatch(id)}
              >
                {starred ? "Unfavorite" : "Favorite"}
              </MenuItem>
              <MenuItem
                icon={<BookOpenIcon aria-hidden />}
                onSelect={() =>
                  void setParams({
                    view: "wiki",
                    "wiki.page": id,
                    "wiki.agent": null,
                    "wiki.part": null,
                    "wiki.edit": null,
                    "wiki.raw": null,
                  })
                }
              >
                Wiki page
              </MenuItem>
              {showChats ? (
                <MenuItem
                  icon={<MessagesSquareIcon aria-hidden />}
                  onSelect={() =>
                    void setParams({
                      view: "chats",
                      "chats.member": id,
                      "chats.id": null,
                    })
                  }
                >
                  Their chats
                </MenuItem>
              ) : null}
              <MenuItem
                icon={<HistoryIcon aria-hidden />}
                onSelect={() =>
                  void setParams({
                    view: "timeline",
                    "tl.actors": [id],
                    "tl.watch": null,
                  })
                }
              >
                Timeline
              </MenuItem>
              {canStage ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<PowerIcon aria-hidden />}
                    onSelect={() =>
                      setCast({
                        label: character.name,
                        cast: [character],
                        intent: offstage ? "onstage" : "offstage",
                      })
                    }
                  >
                    {offstage ? "Bring onstage" : "Send offstage"}
                  </MenuItem>
                </>
              ) : null}
            </MenuContent>
          </Menu>
        </DetailActionsEnd>
      </DetailActions>

      {character.summary ? (
        <DetailAbout>{character.summary}</DetailAbout>
      ) : null}

      <RightNow character={character} company={company} />

      {isAgent ? <Desires id={id} /> : null}

      <Folds>
        {folds.map(({ value, title, Section, Summary }) => (
          <Fold
            key={value}
            value={value}
            title={title}
            summary={<Summary entity={entity} />}
          >
            <Section entity={entity} />
          </Fold>
        ))}
      </Folds>

      {isAgent ? (
        <CharacterMemorySheet
          id={id}
          name={character.name}
          open={memoryOpen}
          onOpenChange={setMemoryOpen}
        />
      ) : null}
      {showBrain ? (
        <CharacterBrainSheet
          id={id}
          name={character.name}
          open={brainOpen}
          onOpenChange={setBrainOpen}
        />
      ) : null}
      <CastDialog request={cast} onOpenChange={() => setCast(null)} />
    </Detail>
  );
}

/**
 * Errors can run to a paragraph of paths and hints; the whole text opens on
 * demand.
 */
function FailureLine({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="group/failure flex items-start gap-2 rounded-[0.75rem] bg-[color-mix(in_oklch,var(--ui-accent),transparent_88%)] px-2.5 py-2 text-start text-[0.8125rem] leading-[1.45] text-ui-accent [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <CircleAlertIcon aria-hidden />
      <span className="min-w-0 truncate wrap-anywhere group-aria-expanded/failure:max-h-48 group-aria-expanded/failure:overflow-y-auto group-aria-expanded/failure:whitespace-normal">
        <strong>Latest turn failed: </strong>
        {error}
      </span>
    </button>
  );
}
