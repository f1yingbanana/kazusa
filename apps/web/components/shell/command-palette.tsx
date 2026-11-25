"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { parseAsString, useQueryStates, type inferParserType } from "nuqs";
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  HistoryIcon,
  MapIcon,
  MapPinIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { CharacterSummary } from "@kazusa/client";
import { chatIcon } from "@/components/entities/chips";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { chatsParsers } from "@/components/views/chats/search-params";
import { settingsParsers } from "@/components/views/settings/search-params";
import { timelineParsers } from "@/components/views/timeline/search-params";
import { wikiParsers } from "@/components/views/wiki/search-params";
import { worldParsers } from "@/components/views/world/search-params";
import { PLACE_PREFIX } from "@/components/views/world/world-state";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlaces, usePosition } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useWikiList } from "@/hooks/use-wiki";
import { placeName } from "@/lib/location/places";
import { SETTINGS_CATEGORIES } from "@/lib/registry/settings";
import { STAGE_VIEWS } from "@/lib/registry/views";
import {
  groupRanked,
  KIND_WEIGHT,
  normalize,
  rank,
  type ResultKind,
  type SearchEntry,
} from "@/lib/search/rank";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { useWatchlist } from "@/lib/state/preferences-store";
import { markQuietSelection, openPlayDialog } from "@/lib/state/ui-store";

/** Every URL key a result can set; one change moves view and selection. */
const PARSERS = {
  view: parseAsString,
  sel: entityRefParser,
  character: parseAsString,
  ...chatsParsers,
  ...wikiParsers,
  ...worldParsers,
  ...settingsParsers,
  ...timelineParsers,
};
type Patch = Partial<inferParserType<typeof PARSERS>>;
type Go = (patch: Patch) => void;

/** A page itself: no tab, edit or new-page form left open from before. */
const PAGE_ONLY = {
  "wiki.part": null,
  "wiki.edit": null,
  "wiki.raw": null,
  "wiki.kind": null,
  "wiki.name": null,
  "wiki.tab": null,
} as const;

const HEADINGS: Record<ResultKind, string> = {
  character: "Characters",
  chat: "Your chats",
  place: "Places",
  group: "Groups",
  command: "Go to",
  page: "Wiki",
  observed: "Other chats",
};

/** What the empty palette offers before anything is typed. */
const SUGGESTED_CHATS = 5;

interface PaletteEntry extends SearchEntry {
  readonly icon: ReactNode;
  /** Muted, on the right: what tells two of the same name apart. */
  readonly detail?: string;
  readonly select: () => void;
  readonly character?: CharacterSummary;
  /** An in-person talk going on now: what there is to watch. */
  readonly live?: boolean;
  readonly placeId?: string;
}

/**
 * ⌘K: find anything in the world and go where it lives. A character opens their
 * page in Characters, a place the map at it, a group or lore its wiki page, a
 * chat the chat. The best match, when it is a character or a place, offers what
 * people do next with it right under it.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key?.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      // The input focuses itself on mount; the dialog would take focus back
      // after its opening animation, and the arrow keys with it.
      initialFocus={false}
      description="Characters, places, groups, chats and settings."
    >
      {/* Mounted only while open: nothing is read or ranked when closed. */}
      {open ? <PaletteBody close={() => onOpenChange(false)} /> : null}
    </CommandDialog>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [, setParams] = useQueryStates(PARSERS);
  const go: Go = (patch) => {
    // The inspector follows without covering where you went.
    if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
    void setParams(patch);
    close();
  };
  const entries = usePaletteEntries(go, close);
  // Someone only watching has no chats of their own: others' are what they
  // came for, so those rank where your own would (as the Chats list does).
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
  // cmdk loses its highlight when the list is swapped under it, so the first
  // row is picked here each time the results change; arrows still move it.
  const first = searching
    ? groups[0]?.results[0]?.entry.key
    : suggestions[0]?.[1][0]?.key;
  const [picked, setPicked] = useState<{ query: string; key: string }>();
  const highlighted = picked?.query === deferred ? picked.key : (first ?? "");

  return (
    <Command
      shouldFilter={false}
      loop
      value={highlighted}
      onValueChange={(key) => setPicked({ query: deferred, key })}
    >
      <CommandInput
        // Focused on mount, not after the dialog's opening animation, so
        // typing right after ⌘K isn't lost.
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder="Search"
      />
      <CommandList className="max-h-[min(28rem,60vh)]">
        {searching ? (
          <>
            <CommandEmpty>No matches</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.kind} heading={HEADINGS[group.kind]}>
                {group.results.map(({ entry }) => (
                  <ResultRows
                    key={entry.key}
                    entry={entry}
                    expanded={entry === top}
                    go={go}
                  />
                ))}
                {group.more ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    {group.more} more
                  </p>
                ) : null}
              </CommandGroup>
            ))}
          </>
        ) : (
          suggestions.map(([heading, list]) => (
            <CommandGroup key={heading} heading={heading}>
              {list.map((entry) => (
                <Row key={entry.key} entry={entry} />
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </Command>
  );
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
        entry.key.startsWith("view:") || entry.key.startsWith("command:"),
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
    <CommandItem value={entry.key} onSelect={entry.select}>
      {entry.icon}
      <span className="truncate">{entry.name}</span>
      {entry.detail ? (
        <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
          {entry.detail}
        </span>
      ) : null}
    </CommandItem>
  );
}

/** A result, and under the best match what you'd do next with it. */
function ResultRows({
  entry,
  expanded,
  go,
}: {
  entry: PaletteEntry;
  expanded: boolean;
  go: Go;
}) {
  return (
    <>
      <Row entry={entry} />
      {expanded && entry.character ? (
        <CharacterActions character={entry.character} go={go} />
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
      value={value}
      onSelect={onSelect}
      aria-label={spoken}
      className="pl-8 text-muted-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </CommandItem>
  );
}

/** As the inspector header offers them: message, find, follow. */
function CharacterActions({
  character,
  go,
}: {
  character: CharacterSummary;
  go: Go;
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
          icon={<MessageCircleIcon />}
          label="Message"
          onSelect={() => go({ view: "chats", "chats.dm": character.id })}
        />
      ) : null}
      {placeId && places && resolved.characters === "live" ? (
        <ActionRow
          value={key("map")}
          icon={<MapIcon />}
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
          icon={<MessagesSquareIcon />}
          label="Chats"
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
          icon={<HistoryIcon />}
          label="Timeline"
          onSelect={() =>
            go({
              view: "timeline",
              "tl.actors": [character.id],
              "tl.watch": false,
            })
          }
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
      icon={<BookOpenIcon />}
      label="Wiki page"
      onSelect={() =>
        go({
          view: "wiki",
          "wiki.page": id,
          "wiki.agent": null,
          ...PAGE_ONLY,
        })
      }
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
function usePaletteEntries(go: Go, close: () => void): PaletteEntry[] {
  const { characters, byId } = useCharacters();
  const { chats } = useChats();
  const { chats: observed } = useObservedChats();
  const places = usePlaces();
  const { data: wiki } = useWikiList();
  const { resolved, player } = useSources();
  const { hasPermission, canMaintain } = useAccess();
  const watchlist = useWatchlist();

  return useMemo(() => {
    const pages = wiki?.pages ?? [];
    const pageName = new Map(pages.map((page) => [page.id, page.name]));
    const nameOf = (id: string) => byId.get(id)?.name ?? pageName.get(id) ?? id;
    const wikiLive = resolved.wiki === "live";
    const toPage = (id: string) =>
      go({ view: "wiki", "wiki.page": id, "wiki.agent": null, ...PAGE_ONLY });
    const openChat = (chat: ChatInfo) => go(openChatPatch(chat, player.id));
    const watched = new Set(watchlist);
    const list: PaletteEntry[] = [];

    for (const character of characters) {
      const cast = isCast(character);
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
          <PresenceAvatar
            id={character.id}
            name={character.name}
            avatarUrl={character.avatarUrl}
            kind={character.kind}
            size="xs"
          />
        ),
        select: () =>
          cast && wikiLive
            ? go({ view: "characters", character: character.id, ...PAGE_ONLY })
            : wikiLive && pageName.has(character.id)
              ? toPage(character.id)
              : go({ sel: { kind: "character", id: character.id } }),
      });
    }

    for (const chat of chats) {
      const Icon = chatIcon(chat.type);
      const place = chat.placeId ? placeName(places, chat.placeId) : undefined;
      list.push({
        key: `chat:${chat.id}`,
        kind: "chat",
        name: chat.name,
        context: [...chat.members.map(nameOf), place ?? ""],
        detail: place && !chat.name.includes(place) ? place : undefined,
        icon: <Icon />,
        select: () => openChat(chat),
      });
    }

    // A talk going on now first, then the most recent (the list is newest
    // first); one that has ended last.
    observed.forEach((chat, index) => {
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
          0.5 * (1 - index / observed.length),
        detail: chat.ended
          ? "Earlier"
          : place && !chat.name.includes(place)
            ? place
            : undefined,
        live,
        icon: <Icon />,
        select: () => openChat(chat),
      });
    });

    for (const place of places?.places ?? []) {
      list.push({
        key: `place:${place.id}`,
        kind: "place",
        name: place.name,
        aliases: place.aliases,
        context: [
          place.parent ? placeName(places, place.parent) : "",
          place.summary,
        ],
        detail: newWords(
          place.name,
          place.parent ? placeName(places, place.parent) : undefined,
        ),
        // A district before a building in it, a building before its rooms,
        // and an area before a lone place at its level (District, Station).
        boost:
          -Math.min(places?.depth.get(place.id) ?? 0, 3) / 4 +
          (places?.children.get(place.id)?.length ? 0.25 : 0),
        placeId: place.id,
        icon: <MapPinIcon />,
        select: () =>
          go({
            view: "world",
            "world.in": `${PLACE_PREFIX}${place.id}`,
            // The place picks its map; a plane left from before would win.
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
            <UsersRoundIcon />
          ) : person ? (
            <UserRoundIcon />
          ) : (
            <BookOpenIcon />
          ),
          select: () => toPage(page.id),
        });
      }
    }

    for (const view of STAGE_VIEWS) {
      if (view.requiresPermission && !hasPermission(view.requiresPermission))
        continue;
      list.push({
        key: `view:${view.id}`,
        kind: "command",
        name: view.label,
        icon: <view.icon />,
        select: () => go({ view: view.id }),
      });
    }
    for (const category of SETTINGS_CATEGORIES) {
      if (
        (category.requiresPermission &&
          !hasPermission(category.requiresPermission)) ||
        (category.requiresMaintain && !canMaintain)
      )
        continue;
      list.push({
        key: `settings:${category.id}`,
        kind: "command",
        name: category.label,
        context: [category.description, "settings"],
        detail: "Settings",
        icon: <category.icon />,
        select: () => go({ view: "settings", "settings.tab": category.id }),
      });
    }
    if (hasPermission("play")) {
      list.push({
        key: "command:play-as",
        kind: "command",
        name: "Play as…",
        aliases: ["Switch character", "Observer"],
        icon: <ArrowLeftRightIcon />,
        select: () => {
          close();
          openPlayDialog();
        },
      });
    }
    return list;
    // `go` and `close` only close over stable setters.
  }, [
    characters,
    byId,
    chats,
    observed,
    places,
    wiki,
    resolved.wiki,
    player.id,
    watchlist,
    hasPermission,
    canMaintain,
  ]);
}
