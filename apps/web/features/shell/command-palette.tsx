"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  FastForwardIcon,
  HistoryIcon,
  MapIcon,
  MapPinIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PauseIcon,
  PlayIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { parseAsString, useQueryStates, type inferParserType } from "nuqs";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useClockActions, useClockAnchor } from "@/hooks/use-clock";
import { usePlaces, usePosition } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { useWikiList } from "@/hooks/use-wiki";
import { placeName } from "@/lib/location/places";
import {
  groupRanked,
  KIND_WEIGHT,
  normalize,
  rank,
  type ResultKind,
  type SearchEntry,
} from "@/lib/search/rank";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { setPalette, useWatchlist } from "@/lib/state/preferences-store";
import { markQuietSelection, openPlayDialog } from "@/lib/state/ui-store";
import { CommandDialog, CommandGroup, CommandItem } from "@/ui/command";
import { PaletteSwatch } from "@/ui/palette-swatch";
import { PALETTES } from "@/ui/palettes";
import { CharacterAvatar } from "../characters/character-avatar";
import { charactersParsers, profilePatch } from "../characters/search-params";
import { conversationParsers, conversationPatch } from "../chats/open";
import { chatIcon } from "../entities/chat-meta";
import { chatsParsers, PLACE_PREFIX, worldParsers } from "../legacy";
import { wikiParsers } from "../wiki/search-params";
import { settingsParsers } from "../settings/search-params";
import { useAllowedSettingsCategories } from "../settings/settings-sidebar";
import { timelineParsers, timelinePatch } from "../timeline/search-params";
import { wikiPatch } from "../wiki/open";
import { useSections } from "./sections";

const PARSERS = {
  ...charactersParsers,
  ...chatsParsers,
  ...conversationParsers,
  ...wikiParsers,
  ...worldParsers,
  ...settingsParsers,
  ...timelineParsers,
  view: parseAsString,
  sel: entityRefParser,
};
type Values = inferParserType<typeof PARSERS>;
type Patch = { [K in keyof Values]?: Values[K] | null };
type Go = (patch: Patch) => void;

const HEADINGS: Record<ResultKind, string> = {
  character: "Characters",
  chat: "Your chats",
  place: "Places",
  group: "Groups",
  command: "Go to",
  page: "Wiki",
  observed: "Other chats",
};

const SUGGESTED_CHATS = 5;

/** A highlight the person moved, not one the list chose as they typed. */
const PICKS = new Set(["list-navigation", "item-hover", "item-press"]);

const SKIPS = [
  { minutes: 60, label: "Skip ahead an hour" },
  { minutes: 360, label: "Skip ahead six hours" },
] as const;

interface PaletteEntry extends SearchEntry {
  readonly icon: ReactNode;
  /** Muted, at the end: what tells two of the same name apart. */
  readonly detail?: string;
  readonly trailing?: ReactNode;
  readonly disabled?: boolean;
  readonly select: () => void;
  readonly character?: CharacterSummary;
  /** An in-person talk going on now: what there is to watch. */
  readonly live?: boolean;
  readonly placeId?: string;
}

/**
 * ⌘K: find anything in the world and go where it lives. The best match, when it
 * is a character or a place, offers what people do next with it under it.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenedChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A chat opened: on a phone, show the thread rather than the list. */
  onOpenedChat?: () => void;
}) {
  const [query, setQuery] = useState("");
  // The top result is highlighted for each new search, so Enter opens the
  // best match; arrows and the pointer still move it.
  const [top, setTop] = useState<{ query: string; key: string }>();
  const [picked, setPicked] = useState<{ query: string; key: string | null }>();
  useEffect(() => {
    if (!open) {
      setQuery("");
      setPicked(undefined);
    }
  }, [open]);
  const highlighted =
    picked?.query === query
      ? picked.key
      : top?.query === query
        ? top.key
        : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      label="Search people, places, chats and actions"
      placeholder="A name, a place, a chat, or what you want to do…"
      empty="Nothing by that name."
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        setPicked(undefined);
      }}
      highlighted={highlighted}
      onHighlightedChange={(key, details) => {
        if (PICKS.has(details.reason)) setPicked({ query, key });
        else details.cancel();
      }}
    >
      {/* Mounted only while open: nothing is read or ranked when closed. */}
      {open ? (
        <PaletteBody
          query={query}
          onTop={setTop}
          close={() => onOpenChange(false)}
          onOpenedChat={onOpenedChat}
        />
      ) : null}
    </CommandDialog>
  );
}

function PaletteBody({
  query,
  onTop,
  close,
  onOpenedChat,
}: {
  query: string;
  onTop: (top: { query: string; key: string } | undefined) => void;
  close: () => void;
  onOpenedChat?: () => void;
}) {
  const deferred = useDeferredValue(query);
  const [, setParams] = useQueryStates(PARSERS);
  const go: Go = (patch) => {
    // Only silence the drawer when opening a destination alongside selection.
    if (patch.sel && Object.keys(patch).length > 1) {
      markQuietSelection(serializeEntityRef(patch.sel));
    }
    void setParams(patch);
    close();
  };
  const entries = usePaletteEntries({
    go,
    close,
    onOpenedChat,
  });
  // Someone only watching has no chats of their own: others' are what they
  // came for, so those rank where your own would.
  const { watching } = useSources();
  const ownChats = entries.some((entry) => entry.kind === "chat");
  const weights = useMemo(
    () => (watching && !ownChats ? { observed: KIND_WEIGHT.chat } : undefined),
    [watching, ownChats],
  );
  const ranked = useMemo(
    () => rank(deferred, entries, weights),
    [deferred, entries, weights],
  );
  const groups = useMemo(() => groupRanked(ranked), [ranked]);
  const top = ranked[0]?.named ? ranked[0].entry : undefined;
  const suggestions = useSuggestions(entries);
  const searching = Boolean(deferred.trim());
  const first = searching
    ? groups[0]?.results[0]?.entry.key
    : suggestions[0]?.[1][0]?.key;
  useEffect(() => {
    onTop(first ? { query: deferred, key: first } : undefined);
  }, [first, deferred, onTop]);

  if (!searching) {
    return suggestions.map(([heading, list]) => (
      <CommandGroup key={heading} label={heading}>
        {list.map((entry) => (
          <Row key={entry.key} entry={entry} />
        ))}
      </CommandGroup>
    ));
  }

  return groups.map((group) => (
    <CommandGroup
      key={group.kind}
      label={HEADINGS[group.kind]}
      more={group.more}
    >
      {group.results.map(({ entry }) => (
        <ResultRows
          key={entry.key}
          entry={entry}
          expanded={entry === top}
          go={go}
          onOpenedChat={onOpenedChat}
        />
      ))}
    </CommandGroup>
  ));
}

/**
 * Before typing: your latest chats, talks going on now (all a visitor has to
 * watch, having no chats of their own), who you watch, and the sections.
 */
function useSuggestions(
  entries: readonly PaletteEntry[],
): (readonly [string, readonly PaletteEntry[]])[] {
  const watchlist = useWatchlist();
  return useMemo(() => {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const chats = entries
      .filter((entry) => entry.kind === "chat")
      .slice(0, SUGGESTED_CHATS);
    const live = entries
      .filter((entry) => entry.live)
      .slice(0, SUGGESTED_CHATS);
    const watched = watchlist
      .map((id) => byKey.get(`character:${id}`))
      .filter((entry): entry is PaletteEntry => Boolean(entry));
    const sections = entries.filter(
      (entry) =>
        entry.key.startsWith("view:") || entry.key === "command:play-as",
    );
    return (
      [
        ["Your chats", chats],
        ["Happening now", live],
        ["Watching", watched],
        ["Go to", sections],
      ] as const
    ).filter(([, list]) => list.length > 0);
  }, [entries, watchlist]);
}

function Row({ entry }: { entry: PaletteEntry }) {
  return (
    <CommandItem
      value={entry.key}
      label={entry.name}
      icon={entry.icon}
      disabled={entry.disabled}
      trailing={
        entry.trailing ??
        (entry.detail ? (
          <span className="max-w-[45%] shrink-0 truncate text-xs text-ui-soft">
            <span className="sr-only">, </span>
            {entry.detail}
          </span>
        ) : undefined)
      }
      onSelect={entry.select}
    >
      {entry.name}
    </CommandItem>
  );
}

function ResultRows({
  entry,
  expanded,
  go,
  onOpenedChat,
}: {
  entry: PaletteEntry;
  expanded: boolean;
  go: Go;
  onOpenedChat?: () => void;
}) {
  return (
    <>
      <Row entry={entry} />
      {expanded && entry.character ? (
        <CharacterActions
          character={entry.character}
          go={go}
          onOpenedChat={onOpenedChat}
        />
      ) : null}
      {expanded && entry.placeId ? (
        <PlaceActions id={entry.placeId} go={go} />
      ) : null}
    </>
  );
}

function ActionRow({
  value,
  icon,
  label,
  spoken,
  onSelect,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  /** What a screen reader says, when the icon carries part of the meaning. */
  spoken?: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      inset
      value={value}
      label={label}
      aria-label={spoken}
      icon={icon}
      onSelect={onSelect}
    >
      {label}
    </CommandItem>
  );
}

/** As their profile offers them: message, find, their chats, timeline. */
function CharacterActions({
  character,
  go,
  onOpenedChat,
}: {
  character: CharacterSummary;
  go: Go;
  onOpenedChat?: () => void;
}) {
  const { resolved, watching, player } = useSources();
  const { canPlay } = useAccess();
  const { available: canObserve } = useObservedChats();
  const places = usePlaces();
  const position = usePosition(character.id);
  const placeId = position?.kind === "at" ? position.placeId : undefined;
  const isAgent = character.kind === "agent";
  const yourself = character.id === player.id;
  // Watching, only the console is yours to write in.
  const canMessage =
    isAgent &&
    resolved.chats === "live" &&
    canPlay &&
    !yourself &&
    (!watching || Boolean(character.isSystemAgent));
  const key = (action: string) => `action:${action}:${character.id}`;
  return (
    <>
      {canMessage ? (
        <ActionRow
          value={key("message")}
          icon={<MessageCircleIcon aria-hidden />}
          label="Message"
          onSelect={() => {
            go({ view: "chats", "chats.dm": character.id });
            onOpenedChat?.();
          }}
        />
      ) : null}
      {placeId && places && resolved.characters === "live" ? (
        <ActionRow
          value={key("map")}
          icon={<MapIcon aria-hidden />}
          // Where they are is the news; the map icon says where it leads.
          label={placeName(places, placeId)}
          spoken={`Show on map at ${placeName(places, placeId)}`}
          onSelect={() =>
            go({
              view: "world",
              "world.in": `${PLACE_PREFIX}${placeId}`,
              // The place picks its map; a plane left from before would win.
              "world.plane": null,
              sel: { kind: "character", id: character.id },
            })
          }
        />
      ) : null}
      {isAgent && canObserve && !yourself ? (
        <ActionRow
          value={key("chats")}
          icon={<MessagesSquareIcon aria-hidden />}
          label="Their chats"
          onSelect={() =>
            go({
              view: "chats",
              "chats.member": character.id,
              "chats.id": null,
            })
          }
        />
      ) : null}
      {resolved.timeline === "live" ? (
        <ActionRow
          value={key("timeline")}
          icon={<HistoryIcon aria-hidden />}
          label="Timeline"
          onSelect={() => go(timelinePatch([character.id]))}
        />
      ) : null}
    </>
  );
}

function PlaceActions({ id, go }: { id: string; go: Go }) {
  const { resolved } = useSources();
  if (resolved.wiki !== "live") return null;
  return (
    <ActionRow
      value={`action:page:${id}`}
      icon={<BookOpenIcon aria-hidden />}
      label="Wiki page"
      onSelect={() => go(wikiPatch(id))}
    />
  );
}

/**
 * A subtitle only when it says something the name doesn't: "Harbor Street"
 * needs no "Harbor District" beside it, "Mia's Room" does need its dorm.
 */
function newWords(name: string, detail: string | undefined) {
  if (!detail) return undefined;
  const own = new Set(normalize(name).split(" "));
  const lead = normalize(detail).split(" ")[0] ?? "";
  return own.has(lead) ? undefined : detail;
}

/**
 * Everything the palette can find, each knowing where it goes. Rebuilt only
 * when the world's data changes, never per keystroke.
 */
function usePaletteEntries({
  go,
  close,
  onOpenedChat,
}: {
  go: Go;
  close: () => void;
  onOpenedChat?: () => void;
}): PaletteEntry[] {
  const { characters, byId } = useCharacters();
  const { chats } = useChats();
  const { chats: observed } = useObservedChats();
  const places = usePlaces();
  const { data: wiki } = useWikiList();
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  const selfOf = useSelfIn();
  const sections = useSections();
  const settings = useAllowedSettingsCategories();
  const watchlist = useWatchlist();
  const anchor = useClockAnchor();
  const { apply, enabled: clockEnabled } = useClockActions();
  const paused = anchor?.clock.speed === 0;

  return useMemo(() => {
    const pages = wiki?.pages ?? [];
    const pageName = new Map(pages.map((page) => [page.id, page.name]));
    const nameOf = (id: string) => byId.get(id)?.name ?? pageName.get(id) ?? id;
    const wikiLive = resolved.wiki === "live";
    const openChat = (chat: ChatInfo) => {
      go(conversationPatch(chat, selfOf(chat)));
      onOpenedChat?.();
    };
    const run = (action: () => void) => () => {
      action();
      close();
    };
    const watched = new Set(watchlist);
    const list: PaletteEntry[] = [];

    for (const character of characters) {
      const offstage = character.status?.onstage === false;
      const groups = (character.groups ?? []).map(nameOf);
      list.push({
        key: `character:${character.id}`,
        kind: "character",
        name: character.name,
        aliases: character.aliases,
        context: [...groups, character.summary ?? ""],
        boost: (watched.has(character.id) ? 0.6 : 0) - (offstage ? 0.4 : 0),
        detail:
          character.kind === "npc"
            ? "NPC"
            : offstage
              ? "Offstage"
              : (groups[0] ?? undefined),
        character,
        icon: (
          <CharacterAvatar
            id={character.id}
            name={character.name}
            avatarUrl={character.avatarUrl}
            kind={character.kind}
            size="xs"
            decorative
          />
        ),
        select: () =>
          isCast(character) && wikiLive
            ? go(profilePatch(character.id))
            : wikiLive && pageName.has(character.id)
              ? go(wikiPatch(character.id))
              : go({ sel: { kind: "character", id: character.id } }),
      });
    }

    const mine = new Set(chats.map((chat) => chat.id));
    for (const chat of chats) {
      const Icon = chatIcon(chat.type);
      const place = chat.placeId ? placeName(places, chat.placeId) : undefined;
      list.push({
        key: `chat:${chat.id}`,
        kind: "chat",
        name: chat.name,
        context: [...chat.members.map(nameOf), place ?? ""],
        detail: place && !chat.name.includes(place) ? place : undefined,
        icon: <Icon aria-hidden />,
        select: () => openChat(chat),
      });
    }

    // A talk going on now first, then the most recent (the list is newest
    // first); one that has ended last.
    const others = observed.filter((chat) => !mine.has(chat.id));
    others.forEach((chat, index) => {
      const Icon = chatIcon(chat.type);
      const place = chat.placeId ? placeName(places, chat.placeId) : undefined;
      const live = chat.type === "huddle" && !chat.ended;
      list.push({
        key: `observed:${chat.id}`,
        kind: "observed",
        name: chat.name,
        context: [...chat.members.map(nameOf), place ?? ""],
        boost:
          (live ? 0.5 : chat.ended ? -0.5 : 0) +
          0.5 * (1 - index / others.length),
        detail: chat.ended
          ? "Earlier"
          : place && !chat.name.includes(place)
            ? place
            : undefined,
        live,
        icon: <Icon aria-hidden />,
        select: () => openChat(chat),
      });
    });

    for (const place of places?.places ?? []) {
      const parent = place.parent ? placeName(places, place.parent) : "";
      list.push({
        key: `place:${place.id}`,
        kind: "place",
        name: place.name,
        aliases: place.aliases,
        context: [parent, place.summary],
        detail: newWords(place.name, parent || undefined),
        // A district before a building in it, a building before its rooms,
        // and an area before a lone place at its level.
        boost:
          -Math.min(places?.depth.get(place.id) ?? 0, 3) / 4 +
          (places?.children.get(place.id)?.length ? 0.25 : 0),
        placeId: place.id,
        icon: <MapPinIcon aria-hidden />,
        select: () =>
          go({
            view: "world",
            "world.in": `${PLACE_PREFIX}${place.id}`,
            "world.plane": null,
            sel: { kind: "place", id: place.id },
          }),
      });
    }

    // Characters and places have their own results above.
    if (wikiLive) {
      for (const page of pages) {
        if (byId.has(page.id) || places?.byId.has(page.id)) continue;
        const group = page.group === true;
        // Someone with a page who isn't simulated is still a character to
        // whoever types their name.
        const person = !group && page.kind === "person";
        list.push({
          key: `page:${page.id}`,
          kind: group ? "group" : person ? "character" : "page",
          name: page.name,
          aliases: page.aliases,
          context: [page.summary],
          boost: person ? -0.3 : 0,
          detail: person ? "Not simulated" : page.place ? "Place" : undefined,
          icon: group ? (
            <UsersRoundIcon aria-hidden />
          ) : person ? (
            <UserRoundIcon aria-hidden />
          ) : (
            <BookOpenIcon aria-hidden />
          ),
          select: () => go(wikiPatch(page.id)),
        });
      }
    }

    for (const view of sections) {
      list.push({
        key: `view:${view.id}`,
        kind: "command",
        name: view.label,
        icon: <view.icon aria-hidden />,
        select: () => go({ view: view.id }),
      });
    }
    for (const category of settings) {
      list.push({
        key: `settings:${category.id}`,
        kind: "command",
        name: category.label,
        context: [category.description, "settings"],
        detail: "Settings",
        icon: <category.icon aria-hidden />,
        select: () => go({ view: "settings", "settings.tab": category.id }),
      });
    }
    if (hasPermission("play")) {
      list.push({
        key: "command:play-as",
        kind: "command",
        name: "Play as…",
        aliases: ["Switch character", "Observer"],
        icon: <ArrowLeftRightIcon aria-hidden />,
        select: run(openPlayDialog),
      });
    }

    if (anchor) {
      const clock = (
        key: string,
        name: string,
        icon: ReactNode,
        action: Parameters<typeof apply>[0],
      ) =>
        list.push({
          key: `clock:${key}`,
          kind: "command",
          name,
          aliases: ["time", "clock"],
          detail: "Clock",
          disabled: !clockEnabled,
          icon,
          select: run(() => apply(action)),
        });
      clock(
        "toggle",
        paused ? "Resume time" : "Pause time",
        paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />,
        { action: "set_speed", speed: paused ? 1 : 0 },
      );
      for (const speed of [10, 60])
        clock(
          `speed:${speed}`,
          `Run at ${speed}× speed`,
          <FastForwardIcon aria-hidden />,
          { action: "set_speed", speed },
        );
      for (const skip of SKIPS)
        clock(
          `advance:${skip.minutes}`,
          skip.label,
          <FastForwardIcon aria-hidden />,
          { action: "advance", minutes: skip.minutes },
        );
    }

    for (const palette of PALETTES) {
      list.push({
        key: `palette:${palette.value}`,
        kind: "command",
        name: `${palette.label} palette`,
        aliases: ["theme", "colour", "color"],
        icon: <PaletteIcon aria-hidden />,
        trailing: <PaletteSwatch palette={palette.value} size="sm" />,
        select: run(() => setPalette(palette.value)),
      });
    }
    return list;
    // `go`, `close` and the callbacks only close over stable setters.
  }, [
    characters,
    byId,
    chats,
    observed,
    places,
    wiki,
    resolved.wiki,
    selfOf,
    sections,
    settings,
    watchlist,
    hasPermission,
    anchor,
    paused,
    clockEnabled,
  ]);
}
