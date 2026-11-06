import {
  LocationsResponseSchema,
  MoveResponseSchema,
  PlacePositionsResponseSchema,
  PlacesResponseSchema,
  type LocationsResponse,
  type PlacePositions,
  type MoveResponse,
  type PlacesResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const PLACES_KEY = "kazusa/places";
export const LOCATIONS_KEY = "kazusa/locations";
export function isPlacesKey(key: unknown) {
  return Array.isArray(key) && key[0] === PLACES_KEY;
}

/** Matches the records snapshot's SWR key, so a reconnect can revalidate it. */
export function isLocationsKey(key: unknown) {
  return Array.isArray(key) && key[0] === LOCATIONS_KEY;
}

export async function fetchPlaces(): Promise<PlacesResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/places"));
  return PlacesResponseSchema.parse(data);
}

/** Writes where places are drawn to their pages. */
export async function savePlacePositions(
  positions: PlacePositions["positions"],
): Promise<void> {
  const data = await postJson<unknown>(buildUrl("/kazusa/places/positions"), {
    positions,
  } satisfies PlacePositions);
  PlacePositionsResponseSchema.parse(data);
}

export async function fetchLocations(): Promise<LocationsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/locations"));
  return LocationsResponseSchema.parse(data);
}

/** The player goes straight to a place; the backend knows who the player is. */
export async function movePlayer(placeId: string): Promise<MoveResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/move"), { placeId });
  return MoveResponseSchema.parse(data);
}
