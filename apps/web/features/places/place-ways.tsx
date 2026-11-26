"use client";

import { usePlaces } from "@/hooks/use-location";
import { connectionsOf, describeWay } from "@/lib/location/places";
import { Note } from "@/ui/note";
import { PlaceChip } from "../entities/chips";

function WayRow({
  to,
  ways,
  note,
}: {
  to: string;
  ways: string;
  note?: string;
}) {
  return (
    <li className="flex flex-col py-0.5">
      <span className="flex min-w-0 items-center justify-between gap-2">
        <PlaceChip id={to} bare />
        <span className="shrink-0 text-xs text-ui-soft tabular-nums">
          {ways}
        </span>
      </span>
      {note ? (
        <span className="ps-1 text-xs leading-relaxed text-ui-soft">
          {note}
        </span>
      ) : null}
    </li>
  );
}

/** The graph around a place: its area, what is inside, and where ways lead. */
export function PlaceWays({ id }: { id: string }) {
  const places = usePlaces();
  const place = places?.byId.get(id);
  if (!places || !place) return null;

  const parent = place.parent && places.byId.get(place.parent);
  const children = places.children.get(place.id) ?? [];
  const connections = connectionsOf(places, place.id);
  const walk = (minutes: number) => describeWay({ by: "walk", minutes });

  if (!parent && children.length === 0 && connections.length === 0)
    return <Note>Not connected to anywhere.</Note>;

  return (
    <ul className="-ms-1 flex flex-col">
      {parent ? (
        <WayRow to={parent.id} ways={`out · ${walk(place.entryMinutes)}`} />
      ) : null}
      {children.map((child) => (
        <WayRow
          key={child}
          to={child}
          ways={`in · ${walk(places.byId.get(child)?.entryMinutes ?? 1)}`}
        />
      ))}
      {connections.map((connection) => (
        <WayRow
          key={`c:${connection.to}`}
          to={connection.to}
          ways={connection.ways[0] ? describeWay(connection.ways[0]) : ""}
          note={connection.note}
        />
      ))}
    </ul>
  );
}
