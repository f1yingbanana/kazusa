"use client";

import type { WikiPageFormFields } from "@kazusa/client";
import { PlusIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { usePlaces } from "@/hooks/use-location";
import {
  ancestors,
  areaPath,
  connectionsOf,
  describeWay,
  placeName,
} from "@/lib/location/places";
import { Button, IconButton } from "@/ui/button";
import { NumberField } from "@/ui/field";
import { TextInput } from "@/ui/input";
import { EditorSection } from "./editor-parts";
import { WikiLink } from "./links";
import { OnePicker, type PickOption } from "@/ui/combobox";

type Route = NonNullable<WikiPageFormFields["connections"]>[number];

/** Every place as a choice, with the areas it is in under its name. */
export function usePlaceOptions(exclude: ReadonlySet<string> = new Set()) {
  const index = usePlaces();
  const options: PickOption[] = (index?.places ?? [])
    .filter((place) => !exclude.has(place.id))
    .map((place) => ({
      value: place.id,
      label: place.name,
      hint: index ? areaPath(index, place.id) || undefined : undefined,
    }));
  return { index, options };
}

function RouteCard({
  route,
  options,
  modes,
  onChange,
  onRemove,
}: {
  route: Route;
  options: readonly PickOption[];
  modes: readonly string[];
  onChange: (route: Route) => void;
  onRemove: () => void;
}) {
  const modesId = useId();
  const setWay = (at: number, patch: Partial<Route["ways"][number]>) =>
    onChange({
      ...route,
      ways: route.ways.map((way, i) => (i === at ? { ...way, ...patch } : way)),
    });
  return (
    <li className="flex flex-col gap-2.5 rounded-[1rem] bg-ui-ground p-3 motion-safe:animate-ui-rise">
      <div className="flex items-center gap-2">
        <OnePicker
          label="Route to"
          placeholder="To where"
          options={options}
          value={route.to || undefined}
          onChange={(to) => onChange({ ...route, to: to ?? "" })}
          className="flex-1"
        />
        <IconButton label="Take out this route" size="sm" onClick={onRemove}>
          <XIcon aria-hidden />
        </IconButton>
      </div>
      <ul className="flex flex-col gap-1.5">
        {route.ways.map((way, at) => (
          <li key={at} className="flex flex-wrap items-center gap-2">
            <TextInput
              value={way.by}
              list={modesId}
              aria-label="By"
              placeholder="walk"
              className="h-9 w-32"
              onChange={(event) => setWay(at, { by: event.target.value })}
            />
            <NumberField
              label={`Minutes by ${way.by || "this way"}`}
              value={way.minutes}
              min={0}
              unit="min"
              onValueChange={(minutes) =>
                setWay(at, { minutes: Math.max(0, minutes ?? 0) })
              }
              className="[&>div:first-child]:sr-only"
            />
            {route.ways.length > 1 ? (
              <IconButton
                label={`Take out ${way.by || "this way"}`}
                size="sm"
                onClick={() =>
                  onChange({
                    ...route,
                    ways: route.ways.filter((_, i) => i !== at),
                  })
                }
              >
                <XIcon aria-hidden />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
      <datalist id={modesId}>
        {modes.map((mode) => (
          <option key={mode} value={mode} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="ghost"
          size="sm"
          icon={<PlusIcon aria-hidden />}
          onClick={() =>
            onChange({
              ...route,
              ways: [...route.ways, { by: "", minutes: 5 }],
            })
          }
        >
          Another way
        </Button>
        <TextInput
          value={route.note ?? ""}
          aria-label="Note on this route"
          placeholder="Note, like “only by day”"
          className="h-9 min-w-40 flex-1"
          onChange={(event) =>
            onChange({ ...route, note: event.target.value || undefined })
          }
        />
      </div>
    </li>
  );
}

/**
 * Where a place is: the area it is in and the walk from there, what is inside
 * it, and its routes to other places, each with every way of getting there. A
 * route is written on one of its two pages; those on the other show here too.
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
  const within = new Set(
    (index?.places ?? [])
      .filter(
        (place) =>
          place.id === id ||
          (index ? ancestors(index, place.id).includes(id) : false),
      )
      .map((place) => place.id),
  );
  const { options: areas } = usePlaceOptions(within);
  const { options: all } = usePlaceOptions(new Set([id]));
  const routes = fields.connections ?? [];
  const elsewhere = index
    ? connectionsOf(index, id).slice(
        index.byId.get(id)?.connections.length ?? 0,
      )
    : [];
  const modes = [
    ...new Set(
      (index?.places ?? []).flatMap((place) =>
        place.connections.flatMap(({ ways }) => ways.map(({ by }) => by)),
      ),
    ),
  ].sort();
  const inside = index?.children.get(id) ?? [];
  const setRoutes = (next: Route[]) => onChange({ connections: next });

  return (
    <EditorSection
      title="Where it is"
      hint="Where it sits on the map, and how people get to it."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-sm font-bold">Inside</span>
          <OnePicker
            label="Inside"
            placeholder="Nowhere: a top-level place"
            options={areas}
            value={fields.parent}
            onChange={(parent) => onChange({ parent })}
          />
        </div>
        {fields.parent ? (
          <NumberField
            label="On foot from there"
            value={fields.entryMinutes ?? 1}
            min={0}
            unit="min"
            onValueChange={(minutes) =>
              onChange({ entryMinutes: Math.max(0, minutes ?? 0) })
            }
          />
        ) : null}
      </div>
      {inside.length ? (
        <p className="text-[0.8125rem] text-ui-soft">
          {"Inside it: "}
          {inside.slice(0, 8).map((child, at) => (
            <span key={child}>
              {at ? ", " : null}
              <WikiLink id={child} />
            </span>
          ))}
          {inside.length > 8 ? ` and ${inside.length - 8} more` : null}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">Routes</span>
        {routes.length ? (
          <ul className="flex flex-col gap-2">
            {routes.map((route, at) => (
              <RouteCard
                key={at}
                route={route}
                options={all}
                modes={modes}
                onChange={(next) =>
                  setRoutes(routes.map((one, i) => (i === at ? next : one)))
                }
                onRemove={() => setRoutes(routes.filter((_, i) => i !== at))}
              />
            ))}
          </ul>
        ) : null}
        {elsewhere.map((route) => (
          <p key={route.to} className="text-[0.8125rem] text-ui-soft">
            <span className="font-bold text-ui-ink">
              {placeName(index, route.to)}
            </span>
            {` · ${route.ways.map(describeWay).join(", ")} · set on its page`}
          </p>
        ))}
        <Button
          tone="soft"
          size="sm"
          className="self-start"
          icon={<PlusIcon aria-hidden />}
          onClick={() =>
            setRoutes([
              ...routes,
              { to: "", ways: [{ by: "walk", minutes: 5 }] },
            ])
          }
        >
          Add a route
        </Button>
      </div>
    </EditorSection>
  );
}
