"use client";

import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useCharacters } from "@/hooks/use-characters";
import { useWikiLint } from "@/hooks/use-wiki";
import { wikiParsers } from "@/components/views/wiki/search-params";

/**
 * The wiki's problems, counted like an editor's: errors, then warnings. Opens
 * the list of them. While a character's own wiki is open, it counts theirs.
 */
export function ProblemsItem() {
  const [params, setParams] = useQueryStates({
    ...wikiParsers,
    view: parseAsString,
  });
  const agent =
    params.view === "wiki" ? (params["wiki.agent"] ?? undefined) : undefined;
  const { byId } = useCharacters();
  const { data } = useWikiLint(agent);
  const findings = data?.findings ?? [];
  if (findings.length === 0) return null;
  const errors = findings.filter((one) => one.level === "error").length;
  const warnings = findings.length - errors;
  const whose = agent
    ? `${byId.get(agent)?.name ?? agent}'s wiki`
    : "the World Wiki";

  return (
    <button
      type="button"
      title={`Problems in ${whose}`}
      className="flex items-center gap-2 rounded-sm px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() =>
        void setParams({
          view: "wiki",
          "wiki.tab": "lint",
          "wiki.edit": null,
          "wiki.kind": null,
          "wiki.name": null,
          "wiki.raw": null,
        })
      }
    >
      <span className="sr-only">{`Problems in ${whose}:`}</span>
      {errors > 0 ? (
        <span className="flex items-center gap-1 text-destructive">
          <CircleXIcon aria-hidden className="size-3" />
          <span className="tabular-nums">{errors}</span>
          <span className="sr-only">{errors === 1 ? "error" : "errors"}</span>
        </span>
      ) : null}
      {warnings > 0 ? (
        <span className="flex items-center gap-1">
          <TriangleAlertIcon aria-hidden className="size-3" />
          <span className="tabular-nums">{warnings}</span>
          <span className="sr-only">
            {warnings === 1 ? "warning" : "warnings"}
          </span>
        </span>
      ) : null}
    </button>
  );
}
