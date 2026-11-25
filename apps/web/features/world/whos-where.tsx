"use client";

import type { CharacterSummary } from "@kazusa/client";
import { MapPinIcon } from "lucide-react";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { usePlayer } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { matchesQuery } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { Button } from "@/ui/button";
import { EmptySeats } from "@/ui/empty-seats";
import { NO_FAVORITES } from "../characters/favorites";
import { SearchInput } from "@/ui/input";
import { ListPane, ListPaneScroll } from "@/ui/list";
import { Note } from "@/ui/note";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { PLACE_PREFIX, useWorldNow, worldParsers } from "../legacy";
import { conversationParsers } from "../chats/open";
import { askToShowOnMap } from "./map/show-on-map";
import { PlacePeople } from "./place-people";
import { rankRooms, type Talk, useTalks } from "./talks";

const SHOWS = ["all", "talking", "favorites"] as const;
type Show = (typeof SHOWS)[number];

interface Place {
  readonly key: string;
  readonly placeId?: string;
  readonly title: string;
  readonly here: boolean;
  readonly people: readonly CharacterSummary[];
  readonly talks: readonly Talk[];
}

/**
 * Who is where, place by place, laid out as the room is: each talk a group of
 * the people in it, its latest line opening it, then everyone else there. Where
 * you stand comes first, then where someone is speaking, then the liveliest,
 * then whoever is on the way, then the quiet places. Talking narrows it to
 * talks, Favorites to the people you follow (and whoever they're talking with);
 * search finds people, places and what was last said.
 */
export function WhosWhere({ onNavigated }: { onNavigated?: () => void }) {
  const { rooms, travelers, unplaced, isLoading, error } = useWorldNow();
  const [params, setParams] = useQueryStates({
    "world.in": worldParsers["world.in"],
    "world.show": parseAsStringLiteral(SHOWS),
    "world.talk": conversationParsers["world.talk"],
    "world.as": conversationParsers["world.as"],
  });
  const show: Show = params["world.show"] ?? "all";
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const talks = useTalks();
  const speaking = useRealtimeStore((state) => state.typingByChat);
  const player = usePlayer();
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const selectedId = selection?.kind === "character" ? selection.id : null;
  const talkCount = [...talks.values()].reduce((n, list) => n + list.length, 0);
  const talking = show === "talking";
  const favorite = new Set(useWatchlist());
  const favorites = show === "favorites";

  const keepPerson = (c: CharacterSummary) =>
    (!favorites || favorite.has(c.id)) && (!q || matchesQuery(c, q));
  const keepTalk = (talk: Talk) =>
    (!favorites || talk.chat.members.some((m) => favorite.has(m))) &&
    (!q ||
      talk.chat.lastMessage?.text.toLowerCase().includes(q) ||
      talk.chat.members.some((m) => {
        const c = byId.get(m);
        return c ? matchesQuery(c, q) : false;
      }));

  const ranked = rankRooms(rooms, talks, player.placeId, speaking).map(
    (room): Place => {
      const placeMatch = Boolean(q) && room.label.toLowerCase().includes(q);
      const here = (talks.get(room.placeId) ?? []).filter((t) =>
        placeMatch
          ? !favorites || t.chat.members.some((m) => favorite.has(m))
          : keepTalk(t),
      );
      // A talk that's kept keeps all its people (a favorite's company too);
      // the rest are kept on their own.
      const inKept = new Set(here.flatMap((t) => t.chat.members));
      return {
        key: room.placeId,
        placeId: room.placeId,
        title: room.label,
        here: room.placeId === player.placeId,
        talks: here,
        people: room.members.filter(
          (c) =>
            inKept.has(c.id) ||
            (placeMatch ? !favorites || favorite.has(c.id) : keepPerson(c)),
        ),
      };
    },
  );
  // Where you are and where people talk lead; then those on their way, who
  // are going somewhere; then places where people only stand.
  const lively = (p: Place) =>
    p.here || (talks.get(p.placeId ?? "")?.length ?? 0) > 0;
  const places: Place[] = [
    ...ranked.filter(lively),
    ...(talking
      ? []
      : [
          {
            key: "traveling",
            title: "On the way",
            here: false,
            talks: [],
            people: travelers.filter(keepPerson),
          },
        ]),
    ...ranked.filter((p) => !lively(p)),
    ...(talking
      ? []
      : [
          {
            key: "unplaced",
            title: "Somewhere",
            here: false,
            talks: [],
            people: unplaced.filter(keepPerson),
          },
        ]),
  ].filter((p) => (talking ? p.talks.length > 0 : p.people.length > 0));

  const pick = (c: CharacterSummary) => {
    void select({ kind: "character", id: c.id });
    onNavigated?.();
  };
  const openPlace = (placeId: string) => {
    void select({ kind: "place", id: placeId });
    void setParams({
      "world.in": `${PLACE_PREFIX}${placeId}`,
      "world.talk": null,
      "world.as": null,
    });
    askToShowOnMap();
  };

  return (
    <ListPane
      head={
        <SearchInput
          aria-label="Search people, places and talk"
          placeholder="Search people and places"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
    >
      <Segmented<Show>
        aria-label="Show"
        stretch
        value={show}
        onValueChange={(next) =>
          next && void setParams({ "world.show": next === "all" ? null : next })
        }
        className="mb-3"
      >
        <SegmentedItem value="all">All</SegmentedItem>
        <SegmentedItem value="talking">
          Talking
          {talkCount ? (
            <span className="ms-1.5 text-xs tabular-nums opacity-70">
              {talkCount}
            </span>
          ) : null}
        </SegmentedItem>
        <SegmentedItem value="favorites">Favorites</SegmentedItem>
      </Segmented>
      <ListPaneScroll>
        {error || isLoading ? (
          <Note inset="list">
            {error ? "Couldn't load who's here." : "Loading who's here…"}
          </Note>
        ) : places.length === 0 ? (
          q ? (
            <Note inset="list">{`Nothing matches “${query}”.`}</Note>
          ) : talking ? (
            <EmptySeats
              title="All quiet"
              action={
                <Button
                  tone="soft"
                  size="sm"
                  onClick={() => void setParams({ "world.show": null })}
                >
                  See everyone
                </Button>
              }
            >
              Nobody is talking face to face right now. Talks show up here as
              people start one.
            </EmptySeats>
          ) : favorites ? (
            favorite.size ? (
              <EmptySeats title="No favorites around">
                Nobody you&apos;ve favorited is onstage right now.
              </EmptySeats>
            ) : (
              <EmptySeats title="No favorites yet">{NO_FAVORITES}</EmptySeats>
            )
          ) : (
            <Note inset="list">Nobody is onstage yet.</Note>
          )
        ) : (
          places.map((place) => (
            <section
              key={place.key}
              aria-label={place.title}
              className="flex flex-col gap-1"
            >
              <PlaceHeading
                place={place}
                onOpen={
                  place.placeId
                    ? () => openPlace(place.placeId as string)
                    : undefined
                }
              />
              <PlacePeople
                people={place.people}
                talks={place.talks}
                talkingOnly={talking}
                selectedId={selectedId}
                onPick={pick}
                onNavigated={onNavigated}
              />
            </section>
          ))
        )}
      </ListPaneScroll>
    </ListPane>
  );
}

/**
 * A place's name and how many are there; it opens the place on the map. A pin
 * marks where you are.
 */
function PlaceHeading({
  place,
  onOpen,
}: {
  place: Place;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      {place.here ? (
        <MapPinIcon
          aria-label="You're here"
          className="size-3.5 shrink-0 self-center text-ui-accent-ink"
        />
      ) : null}
      <span className="truncate">{place.title}</span>
      <span className="ms-auto shrink-0 text-xs font-bold text-ui-soft tabular-nums">
        {place.people.length}
      </span>
    </>
  );
  const className =
    "flex w-full min-w-0 items-baseline gap-1.5 rounded-[0.625rem] px-3 py-0.5 text-start text-sm font-extrabold";
  return onOpen ? (
    <h2>
      <button
        type="button"
        onClick={onOpen}
        className={`${className} hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-ui-primary`}
      >
        {inner}
      </button>
    </h2>
  ) : (
    <h2 className={className}>{inner}</h2>
  );
}
