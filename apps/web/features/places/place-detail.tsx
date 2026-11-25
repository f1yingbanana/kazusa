"use client";

import { MapIcon, MapPinCheckIcon, MapPinIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { usePlaces, usePlayer } from "@/hooks/use-location";
import { useBackdrop } from "@/hooks/use-scene";
import { ancestors, connectionsOf, placeName } from "@/lib/location/places";
import { BACKDROP_POSITION } from "@/lib/scene/layout";
import { entityRefParser } from "@/lib/state/entity-ref";
import { Button } from "@/ui/button";
import {
  Detail,
  DetailAbout,
  DetailActions,
  DetailHeader,
  DetailMark,
  DetailPicture,
} from "@/ui/detail";
import { Fold, Folds } from "@/ui/fold";
import { Note } from "@/ui/note";
import { Tooltip } from "@/ui/tooltip";
import { VisuallyHidden } from "@/ui/visually-hidden";
import {
  PLACE_PREFIX,
  PlaceChip,
  PlacePeopleSection,
  PlaceWaysSection,
  RichText,
  worldParsers,
} from "../legacy";

/**
 * Laid out like a person: what it is and where it sits, what you can do (go,
 * see it on the map), who is there, then the long reads folded away.
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
  });
  const place = places?.byId.get(id);
  const picture = useBackdrop(id)?.url;

  if (!places) return <Note inset="panel">Loading places…</Note>;
  if (!place)
    return <Note inset="panel">{`No place called "${id}" on this map.`}</Note>;

  const path = ancestors(places, place.id).reverse();
  const nameOf = (pid: string) => placeName(places, pid);
  const lower = place.name.toLowerCase();
  const aliases = place.aliases.filter(
    (a) => a !== place.id && a.toLowerCase() !== lower,
  );
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
          onClick={() =>
            void setParams({
              view: "world",
              "world.in": `${PLACE_PREFIX}${place.id}`,
              "world.plane": null,
              sel: { kind: "place", id: place.id },
            })
          }
        >
          On the map
        </Button>
      </DetailActions>

      {place.summary ? (
        <DetailAbout>
          <RichText text={place.summary} />
        </DetailAbout>
      ) : null}
      {aliases.length ? (
        <p className="text-[0.8125rem] text-ui-soft [&_span]:text-ui-ink">
          Also called <span>{aliases.join(", ")}</span>
        </p>
      ) : null}

      <section aria-label="People">
        <PlacePeopleSection entity={entity} />
      </section>

      <Folds>
        <Fold
          value="ways"
          title="Getting around"
          summary={ways ? `${ways} ways` : "Nowhere"}
        >
          <PlaceWaysSection entity={entity} />
        </Fold>
        {place.bodyMarkdown ? (
          <Fold value="description" title="Description">
            <p className="text-sm leading-[1.6] whitespace-pre-wrap text-ui-soft">
              {place.bodyMarkdown}
            </p>
          </Fold>
        ) : null}
      </Folds>
    </Detail>
  );
}
