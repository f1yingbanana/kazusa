"use client";

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ui-sdk/react/accordion";
import { ChevronDownIcon, MapIcon, MapPinCheckIcon, MapPinIcon, XIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { PlaceChip } from "@/components/entities/chips";
import { PlacePeopleSection } from "@/components/inspector/sections/place-people";
import { PlaceWaysSection } from "@/components/inspector/sections/place-ways";
import { RichText } from "@/components/views/wiki/page-link";
import { worldParsers } from "@/components/views/world/search-params";
import { PLACE_PREFIX } from "@/components/views/world/world-state";
import { usePlaces, usePlayer } from "@/hooks/use-location";
import { ancestors, connectionsOf } from "@/lib/location/places";
import { entityRefParser } from "@/lib/state/entity-ref";

/**
 * A place, laid out like a person: what it is and where it sits, what you can
 * do (go, see it on the map), who is there, then the long reads folded away.
 */
export function HaloPlaceSheet({ id, onClose }: { id: string; onClose?: () => void }) {
  const places = usePlaces();
  const player = usePlayer();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "world.in": worldParsers["world.in"],
    "world.plane": worldParsers["world.plane"],
    sel: entityRefParser,
  });
  const place = places?.byId.get(id);

  if (!places) return <p className="halo-panel-empty">Loading places…</p>;
  if (!place) return <p className="halo-panel-empty">{`No place called "${id}" on this map.`}</p>;

  const path = ancestors(places, place.id).reverse();
  const lower = place.name.toLowerCase();
  const aliases = place.aliases.filter((a) => a !== place.id && a.toLowerCase() !== lower);
  const here = player.placeId === place.id;
  const ways =
    (place.parent ? 1 : 0) +
    (places.children.get(place.id)?.length ?? 0) +
    connectionsOf(places, place.id).length;
  const entity = { kind: "place" as const, id: place.id };

  return (
    <article className="halo-sheet" aria-label={place.name}>
      <header className="halo-sheet-head">
        <span className="halo-place-mark" aria-hidden="true">
          <MapPinIcon className="size-5" />
        </span>
        <div className="halo-sheet-title">
          {path.length ? (
            <nav aria-label="Inside" className="halo-crumbs">
              {path.length > 2 ? (
                <span className="halo-crumb">
                  <span
                    className="halo-crumb-more"
                    title={path
                      .slice(0, -1)
                      .map((pid) => places.byId.get(pid)?.name ?? pid)
                      .join(" › ")}
                  >
                    <span aria-hidden="true">…</span>
                    <span className="sr-only">
                      {path
                        .slice(0, -1)
                        .map((pid) => places.byId.get(pid)?.name ?? pid)
                        .join(", ")}
                    </span>
                  </span>
                </span>
              ) : null}
              {(path.length > 2 ? path.slice(-1) : path).map((pid, index) => (
                <span key={pid} className="halo-crumb">
                  {index > 0 || path.length > 2 ? <span aria-hidden="true">›</span> : null}
                  <PlaceChip id={pid} bare className="halo-crumb-link" />
                </span>
              ))}
            </nav>
          ) : null}
          <h2 className="halo-sheet-name text-balance">{place.name}</h2>
        </div>
        {onClose ? (
          <button
            type="button"
            className="halo-icon-button halo-sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="halo-sheet-actions" role="toolbar" aria-label={`Actions for ${place.name}`}>
        {here ? (
          <span className="halo-here">
            <MapPinCheckIcon aria-hidden className="size-4" />
            {"You're here"}
          </span>
        ) : player.live ? (
          <button
            type="button"
            className="halo-action"
            data-primary=""
            disabled={!player.moveTo}
            onClick={() => void player.moveTo?.(place.id)}
          >
            <MapPinIcon aria-hidden className="size-4" />
            <span className="truncate">Go here</span>
          </button>
        ) : null}
        <button
          type="button"
          className="halo-action"
          onClick={() =>
            void setParams({
              view: "world",
              "world.in": `${PLACE_PREFIX}${place.id}`,
              "world.plane": null,
              sel: { kind: "place", id: place.id },
            })
          }
        >
          <MapIcon aria-hidden className="size-4" />
          <span className="truncate">On the map</span>
        </button>
      </div>

      {place.summary ? (
        <p className="halo-about text-pretty">
          <RichText text={place.summary} />
        </p>
      ) : null}
      {aliases.length ? (
        <p className="halo-aliases">
          Also called <span>{aliases.join(", ")}</span>
        </p>
      ) : null}

      <section className="halo-place-people" aria-label="People">
        <PlacePeopleSection entity={entity} />
      </section>

      <Accordion multiple className="halo-folds">
        <AccordionItem value="ways" className="halo-fold">
          <AccordionHeader className="halo-fold-head">
            <AccordionTrigger className="halo-fold-trigger">
              <span className="halo-fold-title">Getting around</span>
              <span className="halo-fold-summary">{ways ? `${ways} ways` : "Nowhere"}</span>
              <ChevronDownIcon aria-hidden className="halo-fold-chevron size-4" />
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionPanel className="halo-fold-panel">
            <PlaceWaysSection entity={entity} />
          </AccordionPanel>
        </AccordionItem>
        {place.bodyMarkdown ? (
          <AccordionItem value="description" className="halo-fold">
            <AccordionHeader className="halo-fold-head">
              <AccordionTrigger className="halo-fold-trigger">
                <span className="halo-fold-title">Description</span>
                <span className="halo-fold-summary" />
                <ChevronDownIcon aria-hidden className="halo-fold-chevron size-4" />
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel className="halo-fold-panel">
              <p className="halo-description">{place.bodyMarkdown}</p>
            </AccordionPanel>
          </AccordionItem>
        ) : null}
      </Accordion>
    </article>
  );
}
