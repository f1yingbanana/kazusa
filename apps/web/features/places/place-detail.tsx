"use client";

import {
  BookOpenIcon,
  EllipsisIcon,
  MapIcon,
  MapPinCheckIcon,
  MapPinIcon,
} from "lucide-react";
import type { CharacterSummary } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useMemo } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useSelection } from "@/hooks/use-selection";
import { useOffstage } from "@/hooks/use-stage";
import { useLiveStore } from "@/lib/live/state";
import { formatSimDuration } from "@/lib/time/sim";
import { ListRow } from "@/ui/list";
import { useOccupancy, usePlaces, usePlayer } from "@/hooks/use-location";
import { useBackdrop } from "@/hooks/use-scene";
import {
  ancestors,
  connectionsOf,
  headingTo,
  peopleWithin,
  placeName,
} from "@/lib/location/places";
import { BACKDROP_POSITION } from "@/lib/scene/layout";
import { useSources } from "@/lib/source/provider";
import { entityRefParser } from "@/lib/state/entity-ref";
import { Button, IconButton } from "@/ui/button";
import {
  Detail,
  DetailAbout,
  DetailActions,
  DetailActionsEnd,
  DetailHeader,
  DetailMark,
  DetailPicture,
  DetailSection,
} from "@/ui/detail";
import { Fold, Folds } from "@/ui/fold";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/ui/menu";
import { Note } from "@/ui/note";
import { Tooltip } from "@/ui/tooltip";
import { VisuallyHidden } from "@/ui/visually-hidden";
import {
  PLACE_PREFIX,
  PlaceChip,
  PlaceWaysSection,
  RichText,
  wikiParsers,
  worldParsers,
} from "../legacy";
import { CharacterAvatar } from "../characters/character-avatar";
import { PlacePeople } from "../world/place-people";
import { askToShowOnMap } from "../world/map/show-on-map";
import { useTalks } from "../world/talks";
import { conversationParsers } from "../chats/open";

/**
 * Laid out like a person: what it is and where it sits, what you can do (go,
 * see it on the map, its wiki page under More), who is there and how to get
 * around.
 */
export function PlaceDetail({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const places = usePlaces();
  const player = usePlayer();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "world.in": worldParsers["world.in"],
    "world.plane": worldParsers["world.plane"],
    sel: entityRefParser,
    "world.talk": conversationParsers["world.talk"],
    "world.as": conversationParsers["world.as"],
    "wiki.page": wikiParsers["wiki.page"],
    "wiki.agent": wikiParsers["wiki.agent"],
    "wiki.part": wikiParsers["wiki.part"],
    "wiki.edit": wikiParsers["wiki.edit"],
    "wiki.raw": wikiParsers["wiki.raw"],
  });
  const { resolved } = useSources();
  const place = places?.byId.get(id);
  const picture = useBackdrop(id)?.url;

  if (!places) return <Note inset="panel">Loading places…</Note>;
  if (!place)
    return <Note inset="panel">{`No place called "${id}" on this map.`}</Note>;

  const path = ancestors(places, place.id).reverse();
  const nameOf = (pid: string) => placeName(places, pid);
  const here = player.placeId === place.id;
  const ways =
    (place.parent ? 1 : 0) +
    (places.children.get(place.id)?.length ?? 0) +
    connectionsOf(places, place.id).length;
  const entity = { kind: "place" as const, id: place.id };
  const long = path.length > 2;
  const hiddenPath = path.slice(0, -1);

  return (
    <Detail label={place.name}>
      {picture ? (
        <DetailPicture src={picture} position={BACKDROP_POSITION} />
      ) : null}
      <DetailHeader
        media={
          <DetailMark>
            <MapPinIcon />
          </DetailMark>
        }
        eyebrow={
          path.length ? (
            <nav
              aria-label="Inside"
              className="flex min-w-0 items-center gap-1 overflow-hidden text-xs whitespace-nowrap text-ui-soft"
            >
              {long ? (
                <span className="inline-flex min-w-0 items-center gap-1 last:shrink last:overflow-hidden">
                  <Tooltip label={hiddenPath.map(nameOf).join(" › ")}>
                    <span
                      tabIndex={0}
                      className="cursor-help rounded-[0.375rem] px-1 outline-none hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary"
                    >
                      <span aria-hidden="true">…</span>
                      <VisuallyHidden>
                        {hiddenPath.map(nameOf).join(", ")}
                      </VisuallyHidden>
                    </span>
                  </Tooltip>
                </span>
              ) : null}
              {(long ? path.slice(-1) : path).map((pid, index) => (
                <span
                  key={pid}
                  className="inline-flex min-w-0 items-center gap-1 last:shrink last:overflow-hidden"
                >
                  {index > 0 || long ? <span aria-hidden="true">›</span> : null}
                  <PlaceChip
                    id={pid}
                    bare
                    className="min-w-0 truncate text-xs font-medium text-ui-soft"
                  />
                </span>
              ))}
            </nav>
          ) : null
        }
        title={place.name}
        onClose={onClose}
      />

      <DetailActions label={`Actions for ${place.name}`}>
        {here ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold text-ui-primary inset-ring-[1.5px] inset-ring-ui-primary [&_svg]:size-4">
            <MapPinCheckIcon aria-hidden />
            {"You're here"}
          </span>
        ) : player.live ? (
          <Button
            tone="primary"
            icon={<MapPinIcon aria-hidden />}
            disabled={!player.moveTo}
            onClick={() => void player.moveTo?.(place.id)}
          >
            Go here
          </Button>
        ) : null}
        <Button
          icon={<MapIcon aria-hidden />}
          onClick={() => {
            // Out of any talk, back to the map, and there even if it was
            // already the place in the link.
            void setParams({
              view: "world",
              "world.in": `${PLACE_PREFIX}${place.id}`,
              "world.plane": null,
              "world.talk": null,
              "world.as": null,
              sel: { kind: "place", id: place.id },
            });
            askToShowOnMap();
          }}
        >
          On the map
        </Button>
        {resolved.wiki === "live" ? (
          <DetailActionsEnd>
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    label={`More for ${place.name}`}
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
                  icon={<BookOpenIcon aria-hidden />}
                  onSelect={() =>
                    void setParams({
                      view: "wiki",
                      "wiki.page": place.id,
                      "wiki.agent": null,
                      "wiki.part": null,
                      "wiki.edit": null,
                      "wiki.raw": null,
                    })
                  }
                >
                  Wiki page
                </MenuItem>
              </MenuContent>
            </Menu>
          </DetailActionsEnd>
        ) : null}
      </DetailActions>

      {place.summary ? (
        <DetailAbout>
          <RichText text={place.summary} />
        </DetailAbout>
      ) : null}

      <PlacePeopleSections placeId={place.id} />

      <Folds>
        <Fold
          value="ways"
          title="Getting around"
          summary={ways ? `${ways} ways` : "Nowhere"}
        >
          <PlaceWaysSection entity={entity} />
        </Fold>
      </Folds>
    </Detail>
  );
}

/**
 * Who is here, laid out as the sidebar lays out a place (its talks as groups of
 * the people in them, then everyone else), what's inside it with people in it,
 * and who is on the way here.
 */
function PlacePeopleSections({ placeId }: { placeId: string }) {
  const places = usePlaces();
  const { characters, byId } = useCharacters();
  const [selection, select] = useSelection();
  const ids = useMemo(() => characters.map((c) => c.id), [characters]);
  const occupied = useOccupancy(ids);
  const locations = useLiveStore((state) => state.locations);
  const offstage = useOffstage();
  const now = useSimNow();
  const talks = useTalks().get(placeId) ?? [];
  const arriving = useMemo(
    () =>
      headingTo(
        ids.filter((id) => !offstage.has(id)),
        (id) => locations.get(id),
        placeId,
        now,
      ),
    [ids, offstage, placeId, now, locations],
  );
  if (!places) return null;

  const people = (occupied.at.get(placeId) ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CharacterSummary => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inside = (places.children.get(placeId) ?? [])
    .map((id) => ({ id, count: peopleWithin(places, occupied, id).length }))
    .filter(({ count }) => count > 0);
  const pick = (c: CharacterSummary) =>
    void select({ kind: "character", id: c.id });
  const selectedId = selection?.kind === "character" ? selection.id : null;

  return (
    <>
      <DetailSection title="Here now" meta={people.length || undefined}>
        {people.length ? (
          <div className="-mx-1">
            <PlacePeople
              people={people}
              talks={talks}
              selectedId={selectedId}
              onPick={pick}
            />
          </div>
        ) : (
          <p className="text-[0.8125rem] text-ui-soft">
            Nobody is standing here.
          </p>
        )}
      </DetailSection>
      {inside.length ? (
        <DetailSection title="Inside">
          <ul className="-mx-1 flex flex-col">
            {inside.map(({ id, count }) => (
              <li key={id}>
                <ListRow
                  onClick={() => void select({ kind: "place", id })}
                  title={placeName(places, id)}
                  trailing={
                    <span className="text-xs font-bold text-ui-soft tabular-nums">
                      {count}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
      {arriving.length ? (
        <DetailSection title="On the way here" meta={arriving.length}>
          <ul className="-mx-1 flex flex-col">
            {arriving.map(({ id, arriveAt }) => {
              const c = byId.get(id);
              return c ? (
                <li key={id}>
                  <ListRow
                    current={selectedId === id}
                    onClick={() => pick(c)}
                    leading={
                      <CharacterAvatar
                        id={c.id}
                        name={c.name}
                        avatarUrl={c.avatarUrl}
                        kind={c.kind}
                      />
                    }
                    title={c.name}
                    trailing={
                      <span className="text-xs font-semibold text-ui-soft tabular-nums">
                        {`in ${formatSimDuration(Math.max(0, arriveAt - now))}`}
                      </span>
                    }
                  />
                </li>
              ) : null;
            })}
          </ul>
        </DetailSection>
      ) : null}
    </>
  );
}
