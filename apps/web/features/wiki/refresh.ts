import { useSWRConfig } from "swr";
import { PLACES_KEY } from "@/lib/source/location/http";

/** After a write, every wiki read again, the index's and the map's included. */
export function useRefreshWiki() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        Array.isArray(key) &&
        (String(key[0]).startsWith("kazusa/wiki") || key[0] === PLACES_KEY),
    );
}
