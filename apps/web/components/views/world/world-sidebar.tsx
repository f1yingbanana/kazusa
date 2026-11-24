"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import type { CharacterSummary } from "@kazusa/client";
import { UsersIcon } from "lucide-react";
import { CharacterRow } from "@/components/entities/character-row";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import {
  CastDialog,
  type CastRequest,
} from "@/components/views/characters/cast-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useCast } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useStage } from "@/hooks/use-stage";
import { useClockStore } from "@/lib/live/clock-state";
import { useLiveStore } from "@/lib/live/state";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { matchesQuery } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { markQuietSelection } from "@/lib/state/ui-store";
import { bucket, formatSimDuration, MINUTE } from "@/lib/time/sim";
import { cn } from "@/lib/utils";
import { worldParsers } from "./search-params";
import { PLACE_PREFIX, useWorldNow, type Room } from "./world-state";

/** Faces shown on a place before the rest become "+N". */
const STACK = 4;

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2.5 pt-4 pb-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase first:pt-1">
      {children}
    </h3>
  );
}

/** A place with people in it: its name, where it is, and their faces. */
function RoomRow({
  room,
  active,
  onOpen,
}: {
  room: Room;
  active: boolean;
  onOpen: (placeId: string) => void;
}) {
  const shown = room.members.slice(0, STACK);
  const more = room.members.length - shown.length;
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={() => onOpen(room.placeId)}
      className={cn(
        "flex h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left outline-none hover:bg-sidebar-accent/70 focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-tight">{room.label}</span>
        {room.area ? (
          <span className="truncate text-xs leading-tight text-muted-foreground">
            {room.area}
          </span>
        ) : null}
      </span>
      <span
        className="flex shrink-0 items-center"
        aria-label={room.members.map((c) => c.name).join(", ")}
      >
        {shown.map((character) => (
          <PresenceAvatar
            key={character.id}
            id={character.id}
            name={character.name}
            avatarUrl={character.avatarUrl}
            kind={character.kind}
            size="xs"
            className="-ml-1.5 ring-2 ring-sidebar first:ml-0"
          />
        ))}
        {more > 0 ? (
          <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">
            {`+${more}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * World's sidebar: who is where right now. Only places with someone in them are
 * listed; the map shows the rest. Offstage characters aren't anywhere, so they
 * live in Characters.
 */
export function WorldSidebar({ onNavigated }: SectionSidebarProps) {
  const [{ "world.in": focus }, setParams] = useQueryStates({
    sel: entityRefParser,
    view: parseAsString,
    "world.in": worldParsers["world.in"],
  });
  const [selection, select] = useSelection();
  const watchlist = useWatchlist();
  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);
  const {
    characters,
    onstage,
    cast,
    rooms,
    travelers,
    unplaced,
    watched,
    places,
    isLoading,
    error,
  } = useWorldNow();
  const { apply: canStage } = useStage();
  const [query, setQuery] = useState("");
  const now = useClockStore((state) =>
    travelers.length ? bucket(state.simNow, MINUTE) : 0,
  );
  const locations = useLiveStore((state) =>
    travelers.length ? state.locations : null,
  );

  const selectedId = selection?.kind === "character" ? selection.id : null;
  const matches = useMemo(
    () =>
      query.trim()
        ? characters.filter((c) => matchesQuery(c, query)).slice(0, 60)
        : [],
    [characters, query],
  );

  const onSelect = useCallback(
    (id: string) => {
      void select({ kind: "character", id });
      onNavigated?.();
    },
    [select, onNavigated],
  );

  /** The map flies there and its details open, without covering the list. */
  function openPlace(placeId: string) {
    const sel = { kind: "place", id: placeId } as const;
    markQuietSelection(serializeEntityRef(sel));
    void setParams({
      view: "world",
      "world.in": `${PLACE_PREFIX}${placeId}`,
      sel,
    });
    onNavigated?.();
  }

  const everyone = useCast();
  const [castRequest, setCastRequest] = useState<CastRequest | null>(null);
  function changeCast() {
    setCastRequest({ label: "Everyone", cast: everyone, intent: "choose" });
  }

  const arrival = (id: string) => {
    const arriveAt = locations?.get(id)?.trip?.arriveAt;
    if (!arriveAt || now === 0) return undefined;
    return arriveAt > now
      ? `in ${formatSimDuration(arriveAt - now)}`
      : "arriving";
  };

  const rows = (people: readonly CharacterSummary[], transit = false) =>
    people.map((character) => (
      <CharacterRow
        key={character.id}
        character={character}
        selected={selectedId === character.id}
        starred={watchSet.has(character.id)}
        onSelect={onSelect}
        trailing={transit ? arrival(character.id) : undefined}
      />
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={
          characters.length
            ? `Search ${characters.length} characters`
            : "Search characters"
        }
        label="Search characters"
      />

      {query.trim() ? (
        <section
          aria-label="Search results"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No characters match that search.
            </p>
          ) : (
            rows(matches)
          )}
        </section>
      ) : isLoading ? (
        <div className="flex flex-col gap-1 px-3 py-1" aria-hidden>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {error.message}
        </p>
      ) : onstage.length === 0 ? (
        <Empty className="border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>Nobody is onstage</EmptyTitle>
            <EmptyDescription>
              Bring characters onstage to see them live in the world.
            </EmptyDescription>
          </EmptyHeader>
          {canStage ? (
            <Button variant="outline" size="sm" onClick={changeCast}>
              Choose who's onstage
            </Button>
          ) : null}
        </Empty>
      ) : (
        <nav
          aria-label="Where everyone is"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2"
        >
          {watched.length ? (
            <section aria-label="Watching">
              <Heading>Watching</Heading>
              {rows(watched)}
            </section>
          ) : null}
          {places ? (
            <>
              {rooms.length ? (
                <section aria-label="Now">
                  <Heading>Now</Heading>
                  {rooms.map((room) => (
                    <RoomRow
                      key={room.placeId}
                      room={room}
                      active={focus === `${PLACE_PREFIX}${room.placeId}`}
                      onOpen={openPlace}
                    />
                  ))}
                </section>
              ) : null}
              {travelers.length ? (
                <section aria-label="On the way">
                  <Heading>On the way</Heading>
                  {rows(travelers, true)}
                </section>
              ) : null}
              {unplaced.length ? (
                <section aria-label="Not on the map">
                  <Heading>Not on the map</Heading>
                  {rows(unplaced)}
                </section>
              ) : null}
            </>
          ) : (
            <section aria-label="Onstage">
              <Heading>Onstage</Heading>
              {rows(onstage)}
            </section>
          )}
        </nav>
      )}

      {cast.total > 0 ? (
        <footer className="flex h-10 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {`${cast.onstage} of ${cast.total} onstage`}
          </span>
          {canStage ? (
            <Button variant="ghost" size="xs" onClick={changeCast}>
              Change
            </Button>
          ) : null}
        </footer>
      ) : null}
      <CastDialog
        request={castRequest}
        onOpenChange={(next) => (next ? null : setCastRequest(null))}
      />
    </div>
  );
}
