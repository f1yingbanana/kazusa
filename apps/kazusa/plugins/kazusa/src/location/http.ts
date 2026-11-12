import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  MovePayloadSchema,
  PlacePositionsSchema,
  type LocationRecord as ClientLocationRecord,
  type LocationsResponse,
  type MoveResponse,
  type PlacePositionsResponse,
  type PlacesResponse,
  type TimeOfDay,
} from "@kazusa/client";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { backdropsOnWire } from "../scene/backdrops.ts";
import { USER } from "./config.ts";
import type { LocationRecord } from "./location.ts";
import { backdropOf } from "./map.ts";
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
 * SSE `location` events by the service itself. The map carries the backdrop
 * library and the world's times of day, for the client to pick pictures from.
 */
export function registerLocationHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly location: LocationService;
    /** The world's times of day (`scene.times`), sorted. */
    readonly times: readonly TimeOfDay[];
  },
): void {
  const route = createRouteRegistrar(api);
  const { location } = deps;
  const player = USER.parse(api.pluginConfig?.user ?? {});

  route("places", "GET", async (_req, res) => {
    const world = location.world;
    const map = world?.map;
    sendJson(res, 200, {
      places: (map?.order ?? []).map((id) => {
        const {
          connections,
          aliases,
          backdrop: _own,
          ...place
        } = map!.places.get(id)!;
        const backdrop = backdropOf(map!, id);
        return {
          ...place,
          aliases: [...aliases],
          connections: connections.map(({ ways, ...connection }) => ({
            ...connection,
            ways: [...ways],
          })),
          ...(backdrop === undefined ? {} : { backdrop }),
        };
      }),
      backdrops: backdropsOnWire(world?.backdrops),
      times: deps.times.map((time) => ({ ...time })),
    } satisfies PlacesResponse);
  });

  route("places/positions", "POST", async (req, res) => {
    const { positions } = PlacePositionsSchema.parse(await readJsonBody(req));
    sendJson(res, 200, {
      written: await location.savePositions(positions),
    } satisfies PlacePositionsResponse);
  });

  route("locations", "GET", async (_req, res) => {
    const records: Record<string, ClientLocationRecord> = {};
    await Promise.all(
      (await location.participants()).map(async (id) => {
        const record = await location.record(id);
        if (record) records[id] = clientRecord(record);
      }),
    );
    sendJson(res, 200, { records } satisfies LocationsResponse);
  });

  // The player has no tasks, so they go straight there. Who moves comes from
  // config, never the request.
  route("move", "POST", async (req, res) => {
    const { placeId } = MovePayloadSchema.parse(await readJsonBody(req));
    const record = await location.place(player.id, placeId);
    sendJson(res, 200, {
      record: clientRecord(record),
    } satisfies MoveResponse);
  });
}
