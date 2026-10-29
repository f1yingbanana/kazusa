import {
  LocationsResponseSchema,
  PlacesResponseSchema,
  type LocationsResponse,
  type PlacesResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

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
