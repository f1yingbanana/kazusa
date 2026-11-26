import { useSWRConfig } from "swr";
import { PLACES_KEY } from "@/lib/source/location/http";

/** How long the Gateway takes to read a changed page into the map. */
const MAP_SETTLES_MS = 600;

/**
 * After a write, every wiki read again, and the map's places once the Gateway
 * has read the change into them.
 */
export function useRefreshWiki() {
  const { mutate } = useSWRConfig();
  return async () => {
    setTimeout(
      () => void mutate((key) => Array.isArray(key) && key[0] === PLACES_KEY),
      MAP_SETTLES_MS,
    );
    await mutate(
      (key) => Array.isArray(key) && String(key[0]).startsWith("kazusa/wiki"),
    );
  };
}
