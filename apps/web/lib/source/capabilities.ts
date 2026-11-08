import { DOMAINS, type Capability, type Domain } from "@kazusa/client";

export type SourceKind = "live" | "unavailable";
export type ResolvedSources = Record<Domain, SourceKind>;

/**
 * Resolves each domain independently (D10): a live capability on a reachable
 * backend is live. Everything else is unavailable, and panels say so.
 */
export function resolveSources(input: {
  capabilities: Partial<Record<Domain, Capability>>;
  reachable: boolean;
}): ResolvedSources {
  const resolved = {} as ResolvedSources;
  for (const domain of DOMAINS) {
    resolved[domain] =
      input.capabilities[domain] === "live" && input.reachable
        ? "live"
        : "unavailable";
  }
  return resolved;
}

export function satisfies(
  resolved: ResolvedSources,
  requires: readonly Domain[],
) {
  return requires.every((domain) => resolved[domain] !== "unavailable");
}
