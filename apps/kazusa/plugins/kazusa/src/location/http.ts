import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type {
  LocationRecord as ClientLocationRecord,
  LocationsResponse,
  PlacesResponse,
} from "@kazusa/client";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";
import type { LocationRecord } from "./location.ts";
import type { LocationService } from "./register.ts";

/** A stored record on the wire: the same closed form, with plain arrays. */
export function clientRecord(record: LocationRecord): ClientLocationRecord {
  const { trip, noticed, ...rest } = record;
  return {
    ...rest,
    ...(trip ? { trip: { ...trip, legs: [...trip.legs] } } : {}),
    ...(noticed ? { noticed: [...noticed] } : {}),
  };
}

/**
 * Serves the map and every participant's closed-form position record, so
 * observers compute positions at any sim time themselves. Changes are pushed as
 * SSE `location` events by the service itself.
 */
export function registerLocationHttp(
  api: OpenClawPluginApi,
  deps: { readonly location: LocationService },
): void {
  const route = createRouteRegistrar(api);
  const { location } = deps;

  route("places", "GET", async (_req, res) => {
    const map = location.world?.map;
    sendJson(res, 200, {
      places: (map?.order ?? []).map((id) => {
        const { connections, aliases, ...place } = map!.places.get(id)!;
        return {
          ...place,
          aliases: [...aliases],
          connections: connections.map(({ ways, ...connection }) => ({
            ...connection,
            ways: [...ways],
          })),
        };
      }),
    } satisfies PlacesResponse);
  });

  route("locations", "GET", async (_req, res) => {
    const records: Record<string, ClientLocationRecord> = {};
    await Promise.all(
      location.participants().map(async (id) => {
        const record = await location.record(id);
        if (record) records[id] = clientRecord(record);
      }),
    );
    sendJson(res, 200, { records } satisfies LocationsResponse);
  });
}
