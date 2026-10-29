import {
  LocationsResponseSchema,
  MoveResponseSchema,
  PlacesResponseSchema,
  type LocationsResponse,
  type MoveResponse,
  type PlacesResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const PLACES_KEY = "kazusa/places";
export const LOCATIONS_KEY = "kazusa/locations";

/** Matches the records snapshot's SWR key, so a reconnect can revalidate it. */
export function isLocationsKey(key: unknown) {
  return Array.isArray(key) && key[0] === LOCATIONS_KEY;
}

export async function fetchPlaces(
  baseUrl: string,
  token?: string,
): Promise<PlacesResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/places"),
    undefined,
    token,
  );
  return PlacesResponseSchema.parse(data);
}

export async function fetchLocations(
  baseUrl: string,
  token?: string,
): Promise<LocationsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/locations"),
    undefined,
    token,
  );
  return LocationsResponseSchema.parse(data);
}

/** The player goes straight to a place; the backend knows who the player is. */
export async function movePlayer(
  baseUrl: string,
  placeId: string,
  token?: string,
): Promise<MoveResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/move"),
    { placeId },
    token,
  );
  return MoveResponseSchema.parse(data);
}
