import type { WikiKind } from "@kazusa/client";

export interface WikiPatch {
  readonly view: "wiki";
  readonly "wiki.page": string | null;
  readonly "wiki.agent": string | null;
  readonly "wiki.part": "page" | "memory" | "looks" | "stickers" | "backdrop" | null;
  readonly "wiki.edit": "world" | "own" | null;
  readonly "wiki.raw": "1" | null;
  readonly "wiki.tab": null;
  readonly "wiki.kind": WikiKind | null;
  readonly "wiki.name": string | null;
}

/** Opens a Wiki page (or an agent's own wiki when `page` is null), clearing stale editor params. */
export function wikiPatch(
  page: string | null,
  options: {
    agent?: string | null;
    part?: WikiPatch["wiki.part"];
    edit?: WikiPatch["wiki.edit"];
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
    "wiki.tab": null,
    "wiki.kind": options.kind ?? null,
    "wiki.name": options.name ?? null,
  };
}
