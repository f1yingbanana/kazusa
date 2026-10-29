import { DOMAINS, type Capability, type Domain } from "@kazusa/client";

export type SourceKind = "live" | "mock" | "unavailable";
export type MockMode = "auto" | "all" | "off";
export type ResolvedSources = Record<Domain, SourceKind>;

/** Domains with a mock implementation in `lib/source/mock`. */
export const MOCKABLE: ReadonlySet<Domain> = new Set<Domain>([
  "clock",
  "characters",
  "status",
  "timeline",
  "desires",
  "places",
  "location",
]);

/**
 * What today's plugin serves, until `GET /kazusa/world` reports capabilities.
 * `characters` is live through the `/kazusa/agents` adapter (id, name, avatar).
 */
export const LEGACY_CAPABILITIES: Partial<Record<Domain, Capability>> = {
  characters: "live",
  chats: "live",
};

/**
 * Resolves each domain independently (D10).
 *
 * - `all` forces every mockable domain to mock (development override).
 * - A live capability on a reachable backend is live.
 * - Otherwise a mockable domain is mocked unless mocks are `off`.
 * - Everything else is unavailable, and panels say so.
 */
export function resolveSources(input: {
  capabilities: Partial<Record<Domain, Capability>>;
  reachable: boolean;
  mocks: MockMode;
}): ResolvedSources {
  const resolved = {} as ResolvedSources;
  for (const domain of DOMAINS) {
    const mockable = MOCKABLE.has(domain);
    if (input.mocks === "all" && mockable) resolved[domain] = "mock";
    else if (input.capabilities[domain] === "live" && input.reachable)
      resolved[domain] = "live";
    else if (input.mocks !== "off" && mockable) resolved[domain] = "mock";
    else resolved[domain] = "unavailable";
  }
  return resolved;
}

export function satisfies(
  resolved: ResolvedSources,
  requires: readonly Domain[],
) {
  return requires.every((domain) => resolved[domain] !== "unavailable");
}

export function isMocked(
  resolved: ResolvedSources,
  requires: readonly Domain[],
) {
  return requires.some((domain) => resolved[domain] === "mock");
}
