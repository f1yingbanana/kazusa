import type {
  Knowledge,
  WikiLevel,
  WikiPage,
  WikiReachResponse,
} from "@kazusa/client";

/**
 * A page read in layers, each reaching fewer people: its summary line, its
 * opening, the sections those close to it get, and on someone's own page what
 * only they know.
 */
export type Layer = "summary" | "opening" | "close" | "self";

export const LAYERS: readonly Layer[] = ["summary", "opening", "close", "self"];

/** The furthest layer each depth of knowing reaches. */
const DEEPEST: Readonly<Record<Knowledge["depth"], number>> = {
  none: -1,
  "heard of": 0,
  familiar: 1,
  intimate: 2,
};

/**
 * Whether someone who knows a page this well reads a layer. Only its subject
 * reads the last one, whatever their depth.
 */
export function reads(
  depth: Knowledge["depth"],
  layer: Layer,
  isSubject = false,
): boolean {
  if (layer === "self") return isSubject;
  return LAYERS.indexOf(layer) <= DEEPEST[depth];
}

/** The level of a group's or a member's knowing that a layer needs. */
export const LAYER_LEVEL: Readonly<Record<Exclude<Layer, "self">, WikiLevel>> =
  {
    summary: "heard of",
    opening: "knows",
    close: "close",
  };

/** Who in the cast reads a layer, as the page now stands. */
export function readersOf(
  layer: Layer,
  reach: WikiReachResponse,
): WikiReachResponse["well"] {
  switch (layer) {
    case "summary":
      return [...reach.well, ...reach.knows, ...reach.heard];
    case "opening":
      return [...reach.well, ...reach.knows];
    case "close":
      return reach.well;
    case "self":
      return [];
  }
}

/** A section kept for the page's subject alone, their inner voice. */
export function isOwnSection(
  section: WikiPage["sections"][number],
  subject: string | undefined,
): boolean {
  return (
    subject !== undefined &&
    section.knownBy.length > 0 &&
    section.knownBy.every((id) => id === subject)
  );
}

/** Openings often begin with the summary; a page says it once. */
export function leadAfterSummary(page: Pick<WikiPage, "summary" | "lead">) {
  const summary = page.summary.trim();
  const lead = page.lead.trim();
  if (!summary) return lead;
  const words = summary
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(`^${words.join("\\s+")}(?=$|[\\s\\p{P}])`, "u").exec(
    lead,
  );
  return match ? lead.slice(match[0].length).trim() : lead;
}

/** How a layer's readers are counted, in words, for a person or a thing. */
export function readerWords(
  layer: Layer,
  count: number,
  person: boolean,
  subject: string,
): string {
  if (layer === "self") return `Only ${subject}`;
  const them = person ? "them" : "it";
  const who = count === 0 ? "Nobody" : String(count);
  const one = count <= 1;
  if (layer === "summary")
    return `${who} ${one ? "has" : "have"} heard of ${them}`;
  return `${who} ${one ? "knows" : "know"} ${them}${layer === "close" ? " well" : ""}`;
}
