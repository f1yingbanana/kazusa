"use client";

import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useWikiLint } from "@/hooks/use-wiki";
import { wikiParsers } from "@/components/views/wiki/search-params";

/**
 * Every wiki's problems, the characters' own included, counted like an
 * editor's: errors, then warnings. Opens the list of them.
 */
export function ProblemsItem() {
  const [, setParams] = useQueryStates({
    ...wikiParsers,
    view: parseAsString,
  });
  const { data } = useWikiLint();
  const findings = data?.findings ?? [];
  if (findings.length === 0) return null;
  const errors = findings.filter((one) => one.level === "error").length;
  const warnings = findings.length - errors;

  return (
    <button
      type="button"
      title="Problems in the wiki"
      className="flex items-center gap-2 rounded-sm px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() =>
        void setParams({
          view: "wiki",
          "wiki.agent": null,
          "wiki.tab": "lint",
          "wiki.edit": null,
          "wiki.kind": null,
          "wiki.name": null,
          "wiki.raw": null,
        })
      }
    >
      <span className="sr-only">Problems in the wiki:</span>
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
