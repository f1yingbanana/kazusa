"use client";

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ui-sdk/react/accordion";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuItemIcon,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import {
  BookOpenIcon,
  BrainIcon,
  ChevronDownIcon,
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
  XIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useState, type ComponentType, type ReactNode } from "react";
import { presenceState } from "@/components/entities/presence-avatar";
import { CharacterBrainSheet } from "@/components/inspector/sections/character-brain";
import {
  CharacterContextSection,
  CharacterContextSummary,
} from "@/components/inspector/sections/character-context";
import { CharacterDesiresSection } from "@/components/inspector/sections/character-desires";
import { CharacterMemorySheet } from "@/components/inspector/sections/character-memory";
import {
  CharacterModelSection,
  CharacterModelSummary,
} from "@/components/inspector/sections/character-model";
import { CharacterNowSection } from "@/components/inspector/sections/character-now";
import {
  CharacterRecentSection,
  CharacterRecentSummary,
} from "@/components/inspector/sections/character-recent";
import {
  CharacterStatesSection,
  CharacterStatesSummary,
} from "@/components/inspector/sections/character-states";
import { useStopBrain } from "@/components/inspector/sections/character-stop";
import { Inspector } from "@/components/shell/inspector";
import { CastDialog, type CastRequest } from "@/components/views/characters/cast-dialog";
import { chatsParsers } from "@/components/views/chats/search-params";
import { timelineParsers } from "@/components/views/timeline/search-params";
import { wikiParsers } from "@/components/views/wiki/search-params";
import { useWorldNow } from "@/components/views/world/world-state";
import { useAccess } from "@/hooks/use-access";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useRunsOnModel } from "@/hooks/use-models";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useStage } from "@/hooks/use-stage";
import { useDraftChat } from "@/lib/state/chat-draft";
import { entityRefParser, type EntityRef } from "@/lib/state/entity-ref";
import { toggleWatch, useWatchlist } from "@/lib/state/preferences-store";
import { useSources } from "@/lib/source/provider";
import { HaloFace } from "./halo-face";

const STATE_TEXT = {
  idle: "Awake",
  thinking: "Thinking",
  composing: "Typing",
  offstage: "Offstage",
  unknown: "Not simulated",
} as const;

/** Group ids arrive as `after_school_sweets_club`; people read names. */
function groupLabel(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Fold = {
  value: string;
  title: string;
  Section: ComponentType<{ entity: EntityRef }>;
  Summary: ComponentType<{ entity: EntityRef }>;
};

/**
 * One column, read top to bottom in the order a watcher asks: who is this,
 * what can I do, where are they and with whom, how do they feel. Actions keep
 * the old inspector's rank — talk, go, stop, then look — with the rarely used
 * ones (watch, wiki, chats, timeline, cast) in More. Play-as is deliberately
 * absent: it lives in the roster, not on every character.
 */
export function HaloSheet({ id }: { id: string }) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const isAgent = character?.kind === "agent";
  const status = useCharacterStatus(isAgent ? id : undefined);
  const { rooms } = useWorldNow();
  const { canPlay, canManage, hasPermission } = useAccess();
  const { resolved, watching, operator } = useSources();
  const player = usePlayer();
  const position = usePosition(id);
  const standing = position?.kind === "at" ? position.placeId : undefined;
  const there = usePlace(standing);
  const runsOnModel = useRunsOnModel({ id });
  const watchlist = useWatchlist();
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
    character: parseAsString,
    "chats.id": chatsParsers["chats.id"],
    "chats.dm": chatsParsers["chats.dm"],
    "chats.talk": chatsParsers["chats.talk"],
    "chats.member": chatsParsers["chats.member"],
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
    "wiki.part": wikiParsers["wiki.part"],
    "wiki.edit": wikiParsers["wiki.edit"],
    "wiki.raw": wikiParsers["wiki.raw"],
  });

  if (!character) return <Inspector />;

  const entity: EntityRef = { kind: "character", id };
  const state = presenceState(character.kind, status);
  const room = rooms.find((r) => r.members.some((m) => m.id === id));
  const company = room?.members.filter((m) => m.id !== id) ?? [];
  const firstName = character.name.split(/\s+/)[0];
  const yourself = id === player.id;
  const offstage = status?.onstage === false;
  const failure = status?.brain === "thinking" ? undefined : status?.failure;
  const starred = watchlist.includes(id);

  const open =
    params.view === "chats"
      ? (chats.find((c) => c.id === params["chats.id"]) ??
        (draft?.id === params["chats.id"] ? draft : undefined))
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
    isAgent && resolved.brain === "live" && (!character.isSystemAgent || canManage);
  const showChats = canMessage && canObserve;
  const canStage =
    canManage && isAgent && !character.isSystemAgent && stageLive && !status?.playedBy;

  const folds: Fold[] = [
    { value: "states", title: "States", Section: CharacterStatesSection, Summary: CharacterStatesSummary },
    { value: "recent", title: "Recent", Section: CharacterRecentSection, Summary: CharacterRecentSummary },
    ...(hasPermission("manage") && runsOnModel
      ? [
          { value: "model", title: "Model", Section: CharacterModelSection, Summary: CharacterModelSummary },
          {
            value: "context",
            title: "Context",
            Section: CharacterContextSection,
            Summary: CharacterContextSummary,
          },
        ]
      : []),
  ];

  return (
    <article className="halo-sheet" aria-label={character.name}>
      <header className="halo-sheet-head">
        <HaloFace
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="md"
        />
        <div className="halo-sheet-title">
          <h2 className="halo-sheet-name text-balance">{character.name}</h2>
          <p className="halo-sheet-status" data-state={state}>
            <span className="halo-dot" aria-hidden="true" />
            <span className="truncate">
              {STATE_TEXT[state]}
              {character.kind === "npc" ? " · NPC" : ""}
              {character.groups?.length ? ` · ${groupLabel(character.groups[0])}` : ""}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="halo-icon-button halo-sheet-close"
          aria-label="Close"
          onClick={() => void setParams({ sel: null })}
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </header>

      {failure ? <FailureLine error={failure.error} /> : null}

      <div className="halo-sheet-actions" role="toolbar" aria-label={`Actions for ${firstName}`}>
        {canMessage && !inTheirDm ? (
          <button
            type="button"
            className="halo-action"
            data-primary=""
            disabled={!canPlay}
            onClick={() => void setParams({ view: "chats", "chats.dm": id })}
          >
            <MessageCircleIcon aria-hidden className="size-4" />
            Message
          </button>
        ) : null}
        {canTalk ? (
          <TextAction
            label="Talk in person"
            disabled={!canPlay}
            onClick={() => void setParams({ view: "chats", "chats.talk": id })}
          >
            <SpeechIcon aria-hidden className="size-4" />
          </TextAction>
        ) : canGo ? (
          <TextAction
            label="Go there"
            title={`Go to ${there.name}`}
            disabled={!player.moveTo}
            onClick={() => void player.moveTo?.(there.id)}
          >
            <MapPinIcon aria-hidden className="size-4" />
          </TextAction>
        ) : null}
        {stopper.shown ? (
          <TextAction
            label={stopper.stopping ? "Stopping" : "Stop"}
            disabled={stopper.stopping}
            onClick={stopper.stop}
          >
            {stopper.stopping ? (
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
            ) : (
              <SquareIcon aria-hidden className="size-4" />
            )}
          </TextAction>
        ) : null}

        <span className="halo-actions-end">
          {isAgent ? (
            <IconAction label="Memory" onClick={() => setMemoryOpen(true)}>
              <NotebookPenIcon aria-hidden className="size-4" />
            </IconAction>
          ) : null}
          {showBrain ? (
            <IconAction label="Brain" onClick={() => setBrainOpen(true)}>
              <BrainIcon aria-hidden className="size-4" />
            </IconAction>
          ) : null}
          <Menu>
            <MenuTrigger
              className="halo-action halo-action-icon"
              aria-label={`More for ${character.name}`}
              title="More"
            >
              <EllipsisIcon aria-hidden className="size-4" />
            </MenuTrigger>
            <MenuContent className="halo-pop halo-menu">
                <MenuItem className="halo-menu-item" onSelect={() => toggleWatch(id)}>
                  <MenuItemIcon>
                    <StarIcon aria-hidden className="size-4" data-on={starred ? "" : undefined} />
                  </MenuItemIcon>
                  {starred ? "Unwatch" : "Watch"}
                </MenuItem>
                <MenuItem
                  className="halo-menu-item"
                  onSelect={() =>
                    void setParams({
                      view: "characters",
                      character: id,
                      "wiki.part": null,
                      "wiki.edit": null,
                      "wiki.raw": null,
                    })
                  }
                >
                  <MenuItemIcon>
                    <BookOpenIcon aria-hidden className="size-4" />
                  </MenuItemIcon>
                  Wiki page
                </MenuItem>
                {showChats ? (
                  <MenuItem
                    className="halo-menu-item"
                    onSelect={() =>
                      void setParams({ view: "chats", "chats.member": id, "chats.id": null })
                    }
                  >
                    <MenuItemIcon>
                      <MessagesSquareIcon aria-hidden className="size-4" />
                    </MenuItemIcon>
                    Their chats
                  </MenuItem>
                ) : null}
                <MenuItem
                  className="halo-menu-item"
                  onSelect={() =>
                    void setParams({ view: "timeline", "tl.actors": [id], "tl.watch": null })
                  }
                >
                  <MenuItemIcon>
                    <HistoryIcon aria-hidden className="size-4" />
                  </MenuItemIcon>
                  Timeline
                </MenuItem>
                {canStage ? (
                  <>
                    <MenuSeparator className="halo-menu-sep" />
                    <MenuItem
                      className="halo-menu-item"
                      onSelect={() =>
                        setCast({
                          label: character.name,
                          cast: [character],
                          intent: offstage ? "onstage" : "offstage",
                        })
                      }
                    >
                      <MenuItemIcon>
                        <PowerIcon aria-hidden className="size-4" />
                      </MenuItemIcon>
                      {offstage ? "Bring onstage" : "Send offstage"}
                    </MenuItem>
                  </>
                ) : null}
            </MenuContent>
          </Menu>
        </span>
      </div>

      <section className="halo-now" aria-label="Right now">
        <CharacterNowSection entity={entity} />
        {company.length > 0 ? (
          <ul className="halo-company-list" aria-label="With them">
            {company.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="halo-company-person"
                  title={m.name}
                  onClick={() => void setParams({ sel: { kind: "character", id: m.id } })}
                >
                  <HaloFace id={m.id} name={m.name} avatarUrl={m.avatarUrl} kind={m.kind} size="sm" />
                  <span>{m.name.split(/\s+/)[0]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {isAgent ? (
        <section className="halo-desires" aria-label="Desires">
          <CharacterDesiresSection entity={entity} />
        </section>
      ) : null}

      {character.summary ? (
        <p className="halo-about text-pretty">{character.summary}</p>
      ) : null}

      <Accordion multiple className="halo-folds">
        {folds.map(({ value, title, Section, Summary }) => (
          <AccordionItem key={value} value={value} className="halo-fold">
            <AccordionHeader className="halo-fold-head">
              <AccordionTrigger className="halo-fold-trigger">
                <span className="halo-fold-title">{title}</span>
                <span className="halo-fold-summary">
                  <Summary entity={entity} />
                </span>
                <ChevronDownIcon aria-hidden className="halo-fold-chevron size-4" />
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel className="halo-fold-panel">
              <Section entity={entity} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>

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
    </article>
  );
}

/** Errors can run to a paragraph of paths and hints; the whole text opens on demand. */
function FailureLine({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="halo-failure"
      aria-expanded={open}
      data-open={open ? "" : undefined}
      onClick={() => setOpen((v) => !v)}
    >
      <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
      <span className="halo-failure-text">
        <strong>Latest turn failed: </strong>
        {error}
      </span>
    </button>
  );
}

function TextAction({
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="halo-action"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="halo-action halo-action-icon"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
