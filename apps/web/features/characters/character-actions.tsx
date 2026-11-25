"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  BookOpenIcon,
  BrainIcon,
  CircleAlertIcon,
  EllipsisIcon,
  HistoryIcon,
  IdCardIcon,
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useStage } from "@/hooks/use-stage";
import { usePageName } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { useSources } from "@/lib/source/provider";
import { useDraftChat } from "@/lib/state/chat-draft";
import { toggleWatch, useWatchlist } from "@/lib/state/preferences-store";
import type { Presence } from "@/ui/avatar";
import { Button, IconButton } from "@/ui/button";
import { DetailActions, DetailActionsEnd } from "@/ui/detail";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";
import {
  CharacterBrainSheet,
  CharacterMemorySheet,
  chatsParsers,
  useStopBrain,
  wikiParsers,
} from "../legacy";
import { conversationParsers } from "../chats/open";
import { timelineParsers, timelinePatch } from "../timeline/search-params";
import { wikiPatch } from "../wiki/open";
import { StageDialog, type StageRequest } from "./stage-dialog";
import { PRESENCE_TEXT } from "./presence";
import { profilePatch } from "./search-params";

/**
 * Talk, go, stop, then look: the old inspector's rank, with the rarely used in
 * More, which also opens their profile unless it is the page beside the panel.
 * Play-as is left out on purpose: it lives with the cast, not on everyone.
 */
export function CharacterActions({
  character,
}: {
  character: CharacterSummary;
}) {
  const id = character.id;
  const isAgent = character.kind === "agent";
  const status = useCharacterStatus(isAgent ? id : undefined);
  const { canPlay, canManage } = useAccess();
  const { resolved, watching, operator } = useSources();
  const player = usePlayer();
  const position = usePosition(id);
  const standing = position?.kind === "at" ? position.placeId : undefined;
  const there = usePlace(standing);
  const watchlist = useWatchlist();
  const stopper = useStopBrain(id, character.name);
  const stageLive = Boolean(useStage().apply);
  const { available: canObserve } = useObservedChat(null);
  const { chats } = useChats();
  const draft = useDraftChat();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [cast, setCast] = useState<StageRequest | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [overflowed, setOverflowed] = useState(0);
  const [params, setParams] = useQueryStates({
    view: parseAsString,
    character: parseAsString,
    "chars.tab": parseAsString,
    "chars.look": parseAsString,
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

  const called = firstName(character.name);
  const yourself = id === player.id;
  const offstage = status?.onstage === false;
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
  const onProfile = params.view === "characters" && params.character === id;

  useEffect(() => {
    const node = actionsRef.current;
    if (!node) return;
    const measure = () => setRowWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Re-evaluate overflow when container width or visible buttons change.
  const layoutKey = `${rowWidth}:${Number(canMessage && !inTheirDm)}:${Number(canTalk)}:${Number(canGo)}:${Number(stopper.shown)}:${Number(stopper.stopping)}:${Number(isAgent)}:${Number(showBrain)}`;
  const [settledKey, setSettledKey] = useState(layoutKey);
  const effectiveOverflow = settledKey === layoutKey ? overflowed : 0;

  // Move Memory into More first, then Brain, whenever the row overflows.
  const maxOverflow = (isAgent ? 1 : 0) + (showBrain ? 1 : 0);
  useLayoutEffect(() => {
    const node = actionsRef.current;
    if (!node) return;
    if (settledKey !== layoutKey) {
      setSettledKey(layoutKey);
      setOverflowed(0);
      return;
    }
    if (
      overflowed < maxOverflow &&
      node.scrollWidth > node.clientWidth + 1
    ) {
      setOverflowed((n) => Math.min(maxOverflow, n + 1));
    }
  }, [layoutKey, settledKey, overflowed, maxOverflow]);

  const memoryInMore = isAgent && effectiveOverflow >= 1;
  const brainInMore = showBrain && effectiveOverflow >= (isAgent ? 2 : 1);

  return (
    <>
      <DetailActions ref={actionsRef} label={`Actions for ${called}`}>
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
          {showBrain && !brainInMore ? (
            <IconButton
              label="Brain"
              tone="soft"
              size="md"
              onClick={() => setBrainOpen(true)}
            >
              <BrainIcon aria-hidden />
            </IconButton>
          ) : null}
          {isAgent && !memoryInMore ? (
            <IconButton
              label="Memory"
              tone="soft"
              size="md"
              onClick={() => setMemoryOpen(true)}
            >
              <NotebookPenIcon aria-hidden />
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
              {brainInMore || memoryInMore ? (
                <>
                  {brainInMore ? (
                    <MenuItem
                      icon={<BrainIcon aria-hidden />}
                      onSelect={() => setBrainOpen(true)}
                    >
                      Brain
                    </MenuItem>
                  ) : null}
                  {memoryInMore ? (
                    <MenuItem
                      icon={<NotebookPenIcon aria-hidden />}
                      onSelect={() => setMemoryOpen(true)}
                    >
                      Memory
                    </MenuItem>
                  ) : null}
                  <MenuSeparator />
                </>
              ) : null}
              <MenuItem
                icon={
                  <StarIcon aria-hidden data-on={starred ? "" : undefined} />
                }
                onSelect={() => toggleWatch(id)}
              >
                {starred ? "Unfavorite" : "Favorite"}
              </MenuItem>
              {onProfile ? null : (
                <MenuItem
                  icon={<IdCardIcon aria-hidden />}
                  onSelect={() => void setParams(profilePatch(id))}
                >
                  Profile
                </MenuItem>
              )}
              <MenuItem
                icon={<BookOpenIcon aria-hidden />}
                onSelect={() => void setParams(wikiPatch(id))}
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
                onSelect={() => void setParams(timelinePatch([id]))}
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
      <StageDialog request={cast} onOpenChange={() => setCast(null)} />
    </>
  );
}

/**
 * Thinking, typing or offstage when they are (being awake is the ordinary case,
 * the dot says it), NPC, then their nearest group or, with `doing`, what
 * they're doing now, their group when nothing.
 */
export function StatusLine({
  character,
  presence,
  doing = false,
}: {
  character: CharacterSummary;
  presence: Presence;
  doing?: boolean;
}) {
  const pageName = usePageName();
  const status = useCharacterStatus(
    character.kind === "agent" ? character.id : undefined,
  );
  const group = character.groups?.length ? pageName(character.groups[0]) : null;
  const task =
    doing && status?.onstage !== false ? status?.task?.description : undefined;
  const text = [
    presence === "idle" ? null : PRESENCE_TEXT[presence] || "Not simulated",
    character.kind === "npc" ? "NPC" : null,
    task ?? group,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="group/status flex min-w-0 items-center gap-1.5"
      data-presence={presence}
    >
      <span
        className="size-2 shrink-0 rounded-full bg-ui-accent group-data-[presence=offstage]/status:bg-ui-soft group-data-[presence=offstage]/status:opacity-50 group-data-[presence=unknown]/status:bg-ui-soft group-data-[presence=unknown]/status:opacity-50 group-data-[presence=composing]/status:motion-safe:animate-ui-blink group-data-[presence=thinking]/status:motion-safe:animate-ui-blink"
        aria-hidden="true"
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Errors can run to a paragraph of paths and hints; the whole text opens on
 * demand.
 */
export function FailureLine({ error }: { error: string }) {
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
