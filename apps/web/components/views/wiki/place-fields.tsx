"use client";

import { useEffect, useId, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import type { PlacesResponse, WikiPageFormFields } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlaces } from "@/hooks/use-location";
import {
  ancestors,
  areaPath,
  connectionsOf,
  describeWay,
  placeName,
  type PlaceIndex,
} from "@/lib/location/places";
import { usePlacesResource } from "@/lib/source/provider";
import { WikiLink } from "./page-link";

type Route = NonNullable<WikiPageFormFields["connections"]>[number];

/** A labelled row: label left, control right. */
export function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="pt-1.5 text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

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

/** A picture of a backdrop set, or the space it would take. */
export function BackdropThumb({ url, name }: { url?: string; name: string }) {
  return url ? (
    <img
      src={url}
      alt={`The ${name} backdrop`}
      className="aspect-video w-full max-w-xs rounded-md border object-cover"
    />
  ) : null;
}

/** A place by name, picked from the map's places; empty clears it. */
function PlaceInput({
  value,
  index,
  exclude,
  label,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  index: PlaceIndex | null;
  exclude: ReadonlySet<string>;
  label: string;
  placeholder: string;
  onChange: (id: string | undefined) => void;
}) {
  const listId = useId();
  const named = value ? placeName(index, value) : "";
  const [text, setText] = useState(named);
  useEffect(() => setText(named), [named]);
  const options = (index?.places ?? []).filter(
    (place) => !exclude.has(place.id),
  );
  const settle = (typed: string) => {
    const wanted = typed.trim().toLowerCase();
    if (!wanted) return onChange(undefined);
    const found = options.find(
      (place) =>
        place.name.toLowerCase() === wanted || place.id === typed.trim(),
    );
    if (found) onChange(found.id);
    else setText(named);
  };
  return (
    <>
      <Input
        value={text}
        list={listId}
        aria-label={label}
        placeholder={placeholder}
        className="h-8 w-full max-w-xs text-sm"
        onChange={(event) => {
          setText(event.target.value);
          if (options.some((place) => place.name === event.target.value))
            settle(event.target.value);
        }}
        onBlur={() => settle(text)}
      />
      <datalist id={listId}>
        {options.map((place) => (
          <option key={place.id} value={place.name}>
            {areaPath(index!, place.id)}
          </option>
        ))}
      </datalist>
    </>
  );
}

/** One route: where to, each way of getting there, and a note. */
function RouteCard({
  route,
  index,
  exclude,
  modes,
  onChange,
  onRemove,
}: {
  route: Route;
  index: PlaceIndex | null;
  exclude: ReadonlySet<string>;
  modes: readonly string[];
  onChange: (route: Route) => void;
  onRemove: () => void;
}) {
  const modesId = useId();
  const setWay = (at: number, way: Partial<Route["ways"][number]>) =>
    onChange({
      ...route,
      ways: route.ways.map((one, i) => (i === at ? { ...one, ...way } : one)),
    });
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <PlaceInput
          value={route.to || undefined}
          index={index}
          exclude={exclude}
          label="Route to"
          placeholder="To where"
          onChange={(to) => onChange({ ...route, to: to ?? "" })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Remove route"
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      {route.ways.map((way, at) => (
        <div key={at} className="flex items-center gap-2">
          <Input
            value={way.by}
            list={modesId}
            aria-label="By"
            placeholder="walk"
            className="h-8 w-32 text-sm"
            onChange={(event) => setWay(at, { by: event.target.value })}
          />
          <Input
            type="number"
            min={0}
            value={way.minutes}
            aria-label={`Minutes by ${way.by || "this way"}`}
            className="h-8 w-20 text-sm tabular-nums"
            onChange={(event) =>
              setWay(at, { minutes: Math.max(0, Number(event.target.value)) })
            }
          />
          <span className="text-sm text-muted-foreground">min</span>
          {route.ways.length > 1 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${way.by || "this way"}`}
              onClick={() =>
                onChange({
                  ...route,
                  ways: route.ways.filter((_, i) => i !== at),
                })
              }
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      <datalist id={modesId}>
        {modes.map((mode) => (
          <option key={mode} value={mode} />
        ))}
      </datalist>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() =>
          onChange({ ...route, ways: [...route.ways, { by: "", minutes: 5 }] })
        }
      >
        <PlusIcon />
        Another way
      </Button>
      <Input
        value={route.note ?? ""}
        aria-label="Note"
        placeholder="Note"
        className="h-8 text-sm"
        onChange={(event) =>
          onChange({ ...route, note: event.target.value || undefined })
        }
      />
    </div>
  );
}

/**
 * Where a place is: the area it is in and the walk from there, the places in
 * it, and its routes to others, each with every way of getting there. A route
 * is written on one of its two pages; those written on the other show here
 * too.
 */
export function WhereItIs({
  id,
  fields,
  onChange,
}: {
  id: string;
  fields: WikiPageFormFields;
  onChange: (patch: Partial<WikiPageFormFields>) => void;
}) {
  const index = usePlaces();
  const routes = fields.connections ?? [];
  // Not itself, nor anywhere inside it.
  const inside = new Set(
    (index?.places ?? [])
      .filter(
        (place) => place.id === id || ancestors(index!, place.id).includes(id),
      )
      .map((place) => place.id),
  );
  const elsewhere = index
    ? connectionsOf(index, id).slice(
        index.byId.get(id)?.connections.length ?? 0,
      )
    : [];
  const linked = new Set([
    id,
    ...routes.map(({ to }) => to),
    ...elsewhere.map(({ to }) => to),
  ]);
  const modes = [
    ...new Set(
      (index?.places ?? []).flatMap((place) =>
        place.connections.flatMap(({ ways }) => ways.map(({ by }) => by)),
      ),
    ),
  ].sort();
  const children = index?.children.get(id) ?? [];
  const setRoutes = (next: Route[]) => onChange({ connections: next });

  return (
    <section className="flex max-w-3xl flex-col gap-5">
      <h2 className="text-sm font-semibold">Where it is</h2>
      <Row label="Inside">
        <PlaceInput
          value={fields.parent}
          index={index}
          exclude={inside}
          label="Inside"
          placeholder="Nowhere: top level"
          onChange={(parent) => onChange({ parent })}
        />

        {fields.parent ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={fields.entryMinutes ?? 1}
              aria-label="Minutes on foot from there"
              className="h-8 w-20 text-sm tabular-nums"
              onChange={(event) =>
                onChange({
                  entryMinutes: Math.max(0, Number(event.target.value)),
                })
              }
            />
            <span className="text-sm text-muted-foreground">
              min on foot from there
            </span>
          </div>
        ) : null}
      </Row>
      {children.length ? (
        <Row label="Places inside">
          <p className="pt-1.5 text-sm">
            <Some ids={children} />
          </p>
        </Row>
      ) : null}
      <Row label="Routes">
        {routes.map((route, at) => (
          <RouteCard
            key={at}
            route={route}
            index={index}
            exclude={new Set([...linked].filter((one) => one !== route.to))}
            modes={modes}
            onChange={(next) =>
              setRoutes(routes.map((one, i) => (i === at ? next : one)))
            }
            onRemove={() => setRoutes(routes.filter((_, i) => i !== at))}
          />
        ))}
        {elsewhere.map((route) => (
          <p key={route.to} className="text-sm">
            {placeName(index, route.to)}{" "}
            <span className="text-muted-foreground">
              {route.ways.map(describeWay).join(", ")}, set on its page
            </span>
          </p>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setRoutes([
              ...routes,
              { to: "", ways: [{ by: "walk", minutes: 5 }] },
            ])
          }
        >
          <PlusIcon />
          Add a route
        </Button>
      </Row>
    </section>
  );
}

/** A few pages as links, then how many more. */
function Some({ ids, max = 6 }: { ids: readonly string[]; max?: number }) {
  const shown = ids.slice(0, max);
  return (
    <>
      {shown.map((id, at) => (
        <span key={id}>
          {at ? ", " : ""}
          <WikiLink id={id} />
        </span>
      ))}
      {ids.length > max ? (
        <span className="text-muted-foreground">
          {" "}
          and {ids.length - max} more
        </span>
      ) : null}
    </>
  );
}

/** A place's backdrop, area, places inside and routes, for reading. */
export function PlaceFacts({ id }: { id: string }) {
  const index = usePlaces();
  const place = index?.byId.get(id);
  const { data } = usePlacesResource();
  if (!index || !place) return null;
  const url = backdropPreview(data?.backdrops, place.backdrop);
  const children = index.children.get(id) ?? [];
  const routes = connectionsOf(index, id);
  return (
    <section className="flex flex-col gap-3">
      <BackdropThumb url={url} name={place.backdrop ?? place.name} />
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
        {place.parent ? (
          <>
            <dt className="text-muted-foreground">Inside</dt>
            <dd>
              <WikiLink id={place.parent} />{" "}
              <span className="text-muted-foreground">
                {describeWay({ by: "walk", minutes: place.entryMinutes })}
              </span>
            </dd>
          </>
        ) : null}
        {children.length ? (
          <>
            <dt className="text-muted-foreground">Places inside</dt>
            <dd>
              <Some ids={children} />
            </dd>
          </>
        ) : null}
        {routes.map((route) => (
          <div key={route.to} className="contents">
            <dt className="text-muted-foreground">
              To <WikiLink id={route.to} />
            </dt>
            <dd>{route.ways.map(describeWay).join(", ")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
