"use client";

import { TextButton } from "@/ui/button";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useWikiLint } from "@/hooks/use-wiki";
import { Tooltip } from "@/ui/tooltip";
import { wikiPatch } from "../../wiki/open";
import { wikiParsers } from "../../wiki/search-params";
import { STATUS_DANGER, STATUS_LINK } from "./look";

/** Every wiki's problems, the characters' own included: errors, then warnings. */
export function useProblems() {
  const { data } = useWikiLint();
  const findings = data?.findings ?? [];
  const errors = findings.filter((one) => one.level === "error").length;
  const [, setParams] = useQueryStates({ ...wikiParsers, view: parseAsString });
  return {
    errors,
    warnings: findings.length - errors,
    open: () => void setParams(wikiPatch(null, { tab: "lint" })),
  };
}

export function ProblemsItem() {
  const { errors, warnings, open } = useProblems();
  if (errors + warnings === 0) return null;
  const words = [
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : null,
    warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Tooltip label="Problems in the wiki">
      <TextButton
        aria-label={`Problems in the wiki: ${words}`}
        className={`${errors ? STATUS_DANGER : STATUS_LINK} gap-2`}
        onClick={open}
      >
        {errors ? (
          <span className="inline-flex items-center gap-1">
            <CircleXIcon aria-hidden />
            <span className="tabular-nums">{errors}</span>
          </span>
        ) : null}
        {warnings ? (
          <span className="inline-flex items-center gap-1">
            <TriangleAlertIcon aria-hidden />
            <span className="tabular-nums">{warnings}</span>
          </span>
        ) : null}
      </TextButton>
    </Tooltip>
  );
}
