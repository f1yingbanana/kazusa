import type { WikiKind } from "@kazusa/client";
import type { PagePart, WikiSide, WikiTab } from "./search-params";

export interface WikiPatch {
  readonly view: "wiki";
  readonly "wiki.page": string | null;
  readonly "wiki.agent": string | null;
  readonly "wiki.part": PagePart | null;
  readonly "wiki.edit": WikiSide | null;
  readonly "wiki.raw": "1" | null;
  readonly "wiki.tab": WikiTab | null;
  readonly "wiki.kind": WikiKind | null;
  readonly "wiki.name": string | null;
}

/**
 * Opens a Wiki page (or an agent's own wiki when `page` is null), clearing
 * stale editor params.
 */
export function wikiPatch(
  page: string | null,
  options: {
    agent?: string | null;
    part?: WikiPatch["wiki.part"];
    edit?: WikiPatch["wiki.edit"];
    tab?: WikiPatch["wiki.tab"];
    kind?: WikiKind | null;
    name?: string | null;
  } = {},
): WikiPatch {
  return {
    view: "wiki",
    "wiki.page": page,
    "wiki.agent": options.agent ?? null,
    "wiki.part": options.part ?? null,
    "wiki.edit": options.edit ?? null,
    "wiki.raw": null,
    "wiki.tab": options.tab ?? null,
    "wiki.kind": options.kind ?? null,
    "wiki.name": options.name ?? null,
  };
}
