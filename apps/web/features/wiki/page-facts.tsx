"use client";

import type {
  PlacesResponse,
  WikiPage,
  WikiReachResponse,
} from "@kazusa/client";
import { Fragment } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { usePlaces } from "@/hooks/use-location";
import { connectionsOf, describeWay } from "@/lib/location/places";
import { usePlacesResource } from "@/lib/source/provider";
import { Infobox, InfoboxRow } from "@/ui/infobox";
import { WikiLink } from "./links";
import { MEMBERSHIP_WORD, Names } from "./reach";

/** A set's picture to show it by: its plain daytime one, else its first. */
export function backdropPreview(
  backdrops: PlacesResponse["backdrops"] | undefined,
  set: string | undefined,
): string | undefined {
  const files = set ? backdrops?.[set]?.files : undefined;
  if (!files?.length) return undefined;
  return (
    files.find((file) => !file.state && file.time === "day") ??
    files.find((file) => !file.state) ??
    files[0]
  ).url;
}

/** A few pages as links, comma by comma, then how many more. */
function Links({ ids, max = 8 }: { ids: readonly string[]; max?: number }) {
  const shown = ids.slice(0, max);
  return (
    <>
      {shown.map((id, at) => (
        <Fragment key={id}>
          {at ? ", " : null}
          <WikiLink id={id} />
        </Fragment>
      ))}
      {ids.length > max ? (
        <span className="text-ui-soft">{` and ${ids.length - max} more`}</span>
      ) : null}
    </>
  );
}

/**
 * The box beside a page, as a wiki has: its picture, then the facts the world
 * runs on. A place's area, what is in it and the ways out; a person's groups;
 * who is in a group. Nothing when it has none.
 */
export function PageFacts({
  page,
  reach,
  className,
}: {
  page: WikiPage;
  reach?: WikiReachResponse | undefined;
  className?: string;
}) {
  const places = usePlaces();
  const { data: placesData } = usePlacesResource();
  const { byId } = useCharacters();
  const place = page.place ? places?.byId.get(page.id) : undefined;
  const person = page.kind === "person" ? byId.get(page.id) : undefined;
  const picture = place
    ? backdropPreview(placesData?.backdrops, place.backdrop)
    : (person?.portraitUrl ?? person?.avatarUrl);
  const inside = place && places ? (places.children.get(page.id) ?? []) : [];
  const routes = place && places ? connectionsOf(places, page.id) : [];
  const members = page.group ? (reach?.members ?? []) : [];

  return (
    <Infobox
      label={`About ${page.name}`}
      picture={picture ? { src: picture } : undefined}
      caption={place?.backdrop ? place.backdrop.replace(/-/g, " ") : undefined}
      className={className}
    >
      {place?.parent ? (
        <InfoboxRow term="Inside">
          <WikiLink id={place.parent} />
          <span className="block text-xs text-ui-soft">
            {describeWay({ by: "walk", minutes: place.entryMinutes })}
          </span>
        </InfoboxRow>
      ) : null}
      {inside.length ? (
        <InfoboxRow term={`Places inside · ${inside.length}`}>
          <Links ids={inside} />
        </InfoboxRow>
      ) : null}
      {routes.length ? (
        <InfoboxRow term="Ways to">
          <ul className="flex flex-col gap-1.5">
            {routes.map((route) => (
              <li key={route.to}>
                <WikiLink id={route.to} />
                <span className="block text-xs text-ui-soft">
                  {route.ways.map(describeWay).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </InfoboxRow>
      ) : null}
      {page.in?.length ? (
        <InfoboxRow term="Groups">
          <ul className="flex flex-col gap-1.5">
            {page.in.map(({ ref, level }) => (
              <li key={ref}>
                <WikiLink id={ref} />
                <span className="block text-xs text-ui-soft">
                  {MEMBERSHIP_WORD[level]}
                </span>
              </li>
            ))}
          </ul>
        </InfoboxRow>
      ) : null}
      {members.length ? (
        <InfoboxRow term={`Members · ${members.length}`}>
          <Names people={members} max={10} />
        </InfoboxRow>
      ) : null}
    </Infobox>
  );
}
