import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type {
  LocationRecord,
  LocationsResponse,
  PlacesResponse,
} from "@kazusa/client";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";
import type { LocationService } from "./register.ts";

/**
 * Serves the map and every participant's closed-form position record, so
 * observers compute positions at any sim time themselves.
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
    const records: Record<string, LocationRecord> = {};
    await Promise.all(
      location.participants().map(async (id) => {
        const record = await location.record(id);
        if (!record) return;
        const { trip, ...rest } = record;
        records[id] = {
          ...rest,
          ...(trip ? { trip: { ...trip, legs: [...trip.legs] } } : {}),
        };
      }),
    );
    sendJson(res, 200, { records } satisfies LocationsResponse);
  });
}
