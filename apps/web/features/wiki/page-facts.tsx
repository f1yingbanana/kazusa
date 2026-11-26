"use client";

import type {
  PlacesResponse,
  WikiKind,
  WikiPage,
  WikiReachResponse,
} from "@kazusa/client";
import { useMemo, type MouseEvent } from "react";
import { BookUserIcon, HistoryIcon, MapIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { usePlaces } from "@/hooks/use-location";
import {
  connectionsOf,
  describeWay,
  placeName,
  planesOf,
} from "@/lib/location/places";
import { usePlacesResource } from "@/lib/source/provider";
import { entityRefParser } from "@/lib/state/entity-ref";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { Infobox, InfoboxRow } from "@/ui/infobox";
import { CharacterAvatar } from "../characters/character-avatar";
import { useProfilePicture } from "../characters/profile-header";
import { timelineParsers, timelinePatch } from "../timeline/search-params";
import { PLACE_PREFIX, worldParsers } from "../world/world-state";
import { askToShowOnMap } from "../world/map/show-on-map";
import { RichText, WikiLink } from "./links";
import { wikiPatch } from "./open";
import { knownThrough, LEVEL_WORD, MEMBERSHIP_WORD } from "./reach";
import { wikiParsers } from "./search-params";

const ANCHOR_LINK =
  "rounded-[0.3rem] font-semibold text-ui-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary";

const countWord = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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

/**
 * The box beside a page, for small at-a-glance facts only: picture, other
 * names, where it sits, groups, visibility, and counts linking to full lists in
 * the main page.
 */
export function PageFacts({
  page,
  fallback,
  reach,
  className,
}: {
  page?: WikiPage | undefined;
  fallback?: { id: string; name: string; kind?: WikiKind | undefined };
  reach?: WikiReachResponse | undefined;
  className?: string;
}) {
  const places = usePlaces();
  const { data: placesData } = usePlacesResource();
  const { byId } = useCharacters();
  const [params, setParams] = useQueryStates({
    ...wikiParsers,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
    "world.in": worldParsers["world.in"],
    "world.talk": parseAsString,
    "world.as": parseAsString,
    sel: entityRefParser,
    view: parseAsString,
  });
  const jumpTo = (event: MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    if (!params["wiki.part"] || params["wiki.part"] === "page") return;
    event.preventDefault();
    void setParams({ "wiki.part": null }, { history: "replace" });
    let tries = 0;
    const scrollWhenMounted = () => {
      const target = document.getElementById(sectionId);
      if (target) {
        window.history.replaceState(null, "", `#${sectionId}`);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (++tries < 20) requestAnimationFrame(scrollWhenMounted);
    };
    requestAnimationFrame(scrollWhenMounted);
  };
  const id = page?.id ?? fallback?.id ?? "";
  const name = page?.name ?? fallback?.name ?? "";
  const kind = page?.kind ?? fallback?.kind;
  const place = page?.place ? places?.byId.get(id) : undefined;
  const person = kind === "person" ? byId.get(id) : undefined;
  const cast = isCast(person) ? person : undefined;
  const tried = useProfilePicture(cast);
  const placePicture = place
    ? backdropPreview(placesData?.backdrops, place.backdrop)
    : undefined;
  const picture = cast
    ? tried.picture
    : placePicture
      ? { src: placePicture }
      : person?.portraitUrl || person?.avatarUrl
        ? { src: (person.portraitUrl ?? person.avatarUrl)! }
        : undefined;
  const caption = cast ? tried.look : undefined;
  const inside = place && places ? (places.children.get(id) ?? []) : [];
  const routes = place && places ? connectionsOf(places, id) : [];
  const planes = useMemo(
    () => (places ? planesOf(places) : undefined),
    [places],
  );
  const hasMultiplePlanes = useMemo(
    () => (planes ? new Set(planes.values()).size > 1 : false),
    [planes],
  );
  const plane = place && planes ? planes.get(id) : undefined;
  const members = page?.group ? (reach?.members ?? []) : [];
  const aliases = (page?.aliases ?? cast?.aliases ?? [])
    .map((alias) => alias.trim())
    .filter((alias) => Boolean(alias) && alias !== name);
  const groups =
    page?.in ?? (cast?.groups ?? []).map((ref) => ({ ref, level: undefined }));
  const knownBy = page ? knownThrough(page) : [];

  return (
    <Infobox
      label={`About ${name}`}
      picture={picture}
      initials={kind === "person" ? name : undefined}
      caption={caption}
      actions={
        cast?.kind === "agent" || place ? (
          <>
            {cast?.kind === "agent" ? (
              <>
                <Button
                  tone="soft"
                  size="sm"
                  icon={<HistoryIcon aria-hidden />}
                  onClick={() =>
                    void setParams({
                      ...wikiPatch(null),
                      ...timelinePatch([cast.id]),
                    })
                  }
                >
                  Timeline
                </Button>
                <Button
                  tone="soft"
                  size="sm"
                  icon={<BookUserIcon aria-hidden />}
                  onClick={() =>
                    void setParams(wikiPatch(null, { agent: cast.id }))
                  }
                >
                  Their wiki
                </Button>
              </>
            ) : null}
            {place ? (
              <Button
                tone="soft"
                size="sm"
                icon={<MapIcon aria-hidden />}
                onClick={() => {
                  void setParams({
                    ...wikiPatch(null),
                    view: "world",
                    "world.in": `${PLACE_PREFIX}${place.id}`,
                    "world.talk": null,
                    "world.as": null,
                    sel: { kind: "place", id: place.id },
                  });
                  askToShowOnMap();
                }}
              >
                On the map
              </Button>
            ) : null}
          </>
        ) : undefined
      }
      className={className}
    >
      {aliases.length ? (
        <InfoboxRow term="Also known as">{aliases.join(", ")}</InfoboxRow>
      ) : null}
      {page?.home ? (
        <InfoboxRow term="Home">
          <WikiLink id={page.home} />
        </InfoboxRow>
      ) : null}
      {place?.parent ? (
        <InfoboxRow term="Inside">
          <WikiLink id={place.parent} />
          {place.entryMinutes > 0 ? (
            <span className="block text-xs text-ui-soft">
              {describeWay({ by: "walk", minutes: place.entryMinutes })}
            </span>
          ) : null}
        </InfoboxRow>
      ) : null}
      {hasMultiplePlanes && plane ? (
        <InfoboxRow term="Plane">
          <span className="capitalize">{plane}</span>
        </InfoboxRow>
      ) : null}
      {inside.length ? (
        <InfoboxRow term="Places inside">
          <a
            href="#places-inside"
            onClick={(event) => jumpTo(event, "places-inside")}
            className={ANCHOR_LINK}
          >
            {countWord(inside.length, "place", "places")}
          </a>
        </InfoboxRow>
      ) : null}
      {routes.length ? (
        <InfoboxRow term="Ways to">
          <a
            href="#ways-to"
            onClick={(event) => jumpTo(event, "ways-to")}
            className={ANCHOR_LINK}
          >
            {countWord(routes.length, "route", "routes")}
          </a>
        </InfoboxRow>
      ) : null}
      {groups.length ? (
        <InfoboxRow term="Groups">
          <ul className="flex flex-col gap-1.5">
            {groups.map(({ ref, level }) => (
              <li key={ref}>
                <WikiLink id={ref} />
                {level ? (
                  <span className="block text-xs text-ui-soft">
                    {MEMBERSHIP_WORD[level]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </InfoboxRow>
      ) : null}
      {members.length ? (
        <InfoboxRow term="Members">
          <a
            href="#members"
            onClick={(event) => jumpTo(event, "members")}
            className={ANCHOR_LINK}
          >
            {countWord(members.length, "member", "members")}
          </a>
        </InfoboxRow>
      ) : null}
      {knownBy.length ? (
        <InfoboxRow term="Known by">
          <ul className="flex flex-col gap-1.5">
            {knownBy.map(({ ref, level }) => (
              <li key={ref}>
                {ref.toLowerCase() === "everyone" ? (
                  <span className="font-semibold">Everyone</span>
                ) : (
                  <WikiLink id={ref} />
                )}
                <span className="block text-xs text-ui-soft">
                  {LEVEL_WORD[level]}
                </span>
              </li>
            ))}
          </ul>
        </InfoboxRow>
      ) : null}
    </Infobox>
  );
}

/**
 * Structured page sections kept in the main column rather than the infobox:
 * places inside an area, routes out (with timetable/travel notes), and a
 * group's members.
 */
export function PageDetails({
  page,
  reach,
}: {
  page: WikiPage;
  reach?: WikiReachResponse | undefined;
}) {
  const places = usePlaces();
  const { byId } = useCharacters();
  const place = page.place ? places?.byId.get(page.id) : undefined;
  const inside =
    place && places
      ? [...(places.children.get(page.id) ?? [])].sort((a, b) =>
          placeName(places, a).localeCompare(placeName(places, b)),
        )
      : [];
  const routes =
    place && places
      ? [...connectionsOf(places, page.id)].sort((a, b) =>
          placeName(places, a.to).localeCompare(placeName(places, b.to)),
        )
      : [];
  const members = page.group ? (reach?.members ?? []) : [];

  if (!inside.length && !routes.length && !members.length) return null;

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {inside.length ? (
        <section
          id="places-inside"
          aria-label="Places inside"
          className="flex flex-col gap-3 border-t border-ui-line pt-5"
        >
          <h2 className="flex items-baseline gap-2 text-[1.0625rem] font-extrabold">
            Places inside
            <span className="text-xs font-bold text-ui-soft tabular-nums">
              {inside.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-3">
            {inside.map((childId) => {
              const child = places?.byId.get(childId);
              return (
                <li key={childId} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]">
                    <WikiLink id={childId} />
                    {child && child.entryMinutes > 0 ? (
                      <span className="text-xs font-semibold text-ui-soft">
                        {describeWay({
                          by: "walk",
                          minutes: child.entryMinutes,
                        })}
                      </span>
                    ) : null}
                  </div>
                  {child?.summary ? (
                    <p className="text-[0.875rem] leading-relaxed text-ui-soft">
                      <RichText text={child.summary} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {routes.length ? (
        <section
          id="ways-to"
          aria-label="Getting around"
          className="flex flex-col gap-3 border-t border-ui-line pt-5"
        >
          <h2 className="flex items-baseline gap-2 text-[1.0625rem] font-extrabold">
            Getting around
            <span className="text-xs font-bold text-ui-soft tabular-nums">
              {routes.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-3.5">
            {routes.map((route) => (
              <li key={route.to} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]">
                  <WikiLink id={route.to} />
                  <span className="text-xs font-semibold text-ui-soft">
                    {route.ways.map(describeWay).join(" · ")}
                  </span>
                </div>
                {route.note ? (
                  <p className="text-[0.875rem] leading-relaxed text-ui-soft">
                    <RichText text={route.note} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {members.length ? (
        <section
          id="members"
          aria-label="Members"
          className="flex flex-col gap-3 border-t border-ui-line pt-5"
        >
          <h2 className="flex items-baseline gap-2 text-[1.0625rem] font-extrabold">
            Members
            <span className="text-xs font-bold text-ui-soft tabular-nums">
              {members.length}
            </span>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {members.map((member) => {
              const who = byId.get(member.id);
              return (
                <li
                  key={member.id}
                  className="inline-flex items-center gap-2 rounded-full bg-ui-ground py-1 ps-1.5 pe-3 text-[0.875rem]"
                >
                  {who ? (
                    <CharacterAvatar
                      id={who.id}
                      name={who.name}
                      avatarUrl={who.avatarUrl}
                      kind={who.kind}
                      size="xs"
                      decorative
                    />
                  ) : (
                    <Avatar name={member.name} size="xs" decorative />
                  )}
                  <WikiLink id={member.id} />
                  {member.level ? (
                    <span className="text-xs font-semibold text-ui-soft">
                      {MEMBERSHIP_WORD[member.level]}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
