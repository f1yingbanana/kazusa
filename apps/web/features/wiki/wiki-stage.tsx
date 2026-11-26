"use client";

import type { MemoryRunsResponse } from "@kazusa/client";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";
import { useCharacters } from "@/hooks/use-characters";
import {
  useMemoryRuns,
  usePageName,
  useWikiLint,
  useWikiList,
} from "@/hooks/use-wiki";
import { useSources } from "@/lib/source/provider";
import { formatSimTime } from "@/lib/time/sim";
import { changedOnly, diffLines } from "@/lib/wiki/diff";
import {
  buildIndex,
  SHELF_LABEL,
  SHELVES,
  type Shelf,
} from "@/lib/wiki/index-tree";
import { firstName } from "@/lib/format";
import { cx } from "@/ui/cx";
import { Fold, Folds } from "@/ui/fold";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { failureText } from "./failure";
import { usePageTarget } from "./links";
import { PageHead, Sheet } from "./page-header";
import { wikiPatch } from "./open";
import { wikiParsers } from "./search-params";
import { SHELF_ICON } from "./shelf-icon";
import { TheirPage } from "./their-page";
import { WorldPage } from "./world-page";

/**
 * The Wiki's stage: a page, as the world has it or beside one character's notes
 * on it; the list of problems; what each night changed in a character's wiki;
 * or, with nothing open, the wiki's front page.
 */
export function WikiStage() {
  const { resolved } = useSources();
  const [params] = useQueryStates(wikiParsers);
  const agent = params["wiki.agent"] ?? undefined;
  const page = params["wiki.page"];
  const tab = params["wiki.tab"];
  if (resolved.wiki !== "live")
    return <Note inset="panel">The wiki isn&apos;t reachable right now.</Note>;
  if (tab === "lint") return <Problems />;
  if (tab === "nights" && agent) return <Nights key={agent} agent={agent} />;
  if (page && agent)
    return <TheirPage key={`${agent}:${page}`} id={page} agent={agent} />;
  if (page) return <WorldPage key={page} id={page} />;
  return <FrontPage key={agent ?? ""} agent={agent} />;
}

/**
 * Where the Wiki opens: how much is written, shelf by shelf, and the latest
 * diary days. In a character's wiki, the same of what they keep.
 */
function FrontPage({ agent }: { agent: string | undefined }) {
  const { data } = useWikiList(agent);
  const { data: lint } = useWikiLint();
  const { byId } = useCharacters();
  const viewer = agent ? byId.get(agent) : undefined;
  const target = usePageTarget();
  const [, setParams] = useQueryStates(wikiParsers);
  const index = useMemo(() => buildIndex(data?.pages ?? []), [data]);
  const recent = useMemo(
    () =>
      (data?.pages ?? [])
        .filter((page) => page.kind === "day")
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, 3),
    [data],
  );
  const shelves = SHELVES.filter((shelf) => index.counts[shelf]);
  const called = viewer ? firstName(viewer.name) : undefined;
  const findings = (lint?.findings ?? []).filter((f) =>
    agent ? f.agent === agent : true,
  );
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.length - errors;
  const summary = [
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
    warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Sheet label={called ? `${called}'s wiki` : "World Wiki"}>
      <PageHead
        eyebrow={
          viewer ? (
            <span className="flex items-center gap-2 text-[0.8125rem] font-bold text-ui-accent-ink">
              <CharacterAvatar
                id={viewer.id}
                name={viewer.name}
                avatarUrl={viewer.avatarUrl}
                kind={viewer.kind}
                size="xs"
                decorative
              />
              Their own wiki
            </span>
          ) : (
            <span className="text-[0.8125rem] font-bold text-ui-primary">
              The world as it is
            </span>
          )
        }
        title={called ? `${called}'s wiki` : "World Wiki"}
        under={
          findings.length ? (
            <button
              type="button"
              onClick={() => void setParams(wikiPatch(null, { tab: "lint" }))}
              className="-ms-2 inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[0.8125rem] font-bold text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
            >
              <TriangleAlertIcon
                aria-hidden
                className={cx(
                  "size-3.5",
                  errors ? "text-ui-danger" : "text-ui-accent",
                )}
              />
              <span>{summary}</span>
            </button>
          ) : null
        }
      />
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
        {shelves.map((shelf: Shelf, at) => (
          <li
            key={shelf}
            style={{ animationDelay: `${at * 60}ms` }}
            className="motion-safe:animate-ui-rise"
          >
            <div className="flex h-full flex-col gap-3 rounded-[1.25rem] bg-ui-ground p-4">
              <span className="grid size-9 place-items-center rounded-[0.875rem] bg-ui-surface text-ui-primary shadow-ui [&_svg]:size-4.5">
                {SHELF_ICON[shelf]}
              </span>
              <span className="flex flex-col">
                <span className="text-[1.75rem] leading-none font-extrabold tabular-nums">
                  {index.counts[shelf]}
                </span>
                <span className="text-[0.8125rem] font-bold text-ui-soft">
                  {SHELF_LABEL[shelf]}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {recent.length ? (
        <section aria-label="Latest diary days" className="flex flex-col gap-2">
          <h2 className="text-[0.9375rem] font-extrabold">
            Latest in the diary
          </h2>
          <ul className="flex flex-col">
            {recent.map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() =>
                    agent
                      ? void setParams(wikiPatch(page.id, { agent }))
                      : target(page).open()
                  }
                  className="group/day flex w-full items-center gap-3 rounded-[1rem] px-3 py-2.5 text-start transition-colors hover:bg-ui-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary"
                >
                  <span className="text-xs font-bold text-ui-soft tabular-nums">
                    {page.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {page.summary || page.name}
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 text-ui-soft transition-transform group-hover/day:translate-x-0.5 rtl:-scale-x-100"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}

/**
 * What's wrong in every wiki, the World Wiki's first, then each character's
 * own; each problem opens its page.
 */
function Problems() {
  const lint = useWikiLint();
  const nameOf = usePageName();
  const { byId } = useCharacters();
  const target = usePageTarget();
  const [, setParams] = useQueryStates(wikiParsers);
  const groups = useMemo(() => {
    const byWiki = Map.groupBy(
      lint.data?.findings ?? [],
      (finding) => finding.agent ?? "",
    );
    return [...byWiki.entries()].sort(([a], [b]) =>
      !a
        ? -1
        : !b
          ? 1
          : (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b),
    );
  }, [lint.data, byId]);
  const count = lint.data?.findings.length ?? 0;
  return (
    <Sheet label="Problems">
      <PageHead
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-bold text-ui-primary [&_svg]:size-3.5">
            <TriangleAlertIcon aria-hidden />
            Every wiki
          </span>
        }
        title="Problems"
        under={
          <p className="text-[0.9375rem] text-ui-soft">
            {lint.isLoading
              ? ""
              : lint.error && !lint.data
                ? "Couldn't read problems"
                : count
                  ? `${count} found`
                  : "None"}
          </p>
        }
      />
      {lint.error && !lint.data ? <Note>{failureText(lint.error)}</Note> : null}
      {groups.map(([agent, findings]) => (
        <section
          key={agent}
          aria-label={
            agent ? `${byId.get(agent)?.name ?? agent}'s wiki` : "World Wiki"
          }
          className="flex flex-col gap-1"
        >
          <h2 className="flex items-baseline gap-2 px-3 text-sm font-extrabold">
            {agent ? `${byId.get(agent)?.name ?? agent}'s wiki` : "World Wiki"}
            <span className="text-xs font-bold text-ui-soft tabular-nums">
              {findings.length}
            </span>
          </h2>
          <ul className="flex flex-col">
            {findings
              .toSorted((a, b) => a.level.localeCompare(b.level))
              .map((finding, at) => {
                const id = finding.page.split("/").slice(1).join("/");
                return (
                  <li
                    key={`${finding.page}${finding.message}`}
                    style={{ animationDelay: `${Math.min(at, 12) * 30}ms` }}
                    className="motion-safe:animate-ui-rise"
                  >
                    <button
                      type="button"
                      disabled={!id}
                      onClick={() =>
                        agent
                          ? void setParams(wikiPatch(id, { agent }))
                          : target({ id, kind: "concept" }).open()
                      }
                      className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary enabled:hover:bg-ui-tint"
                    >
                      <span
                        aria-label={
                          finding.level === "error" ? "Error" : "Warning"
                        }
                        className={cx(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          finding.level === "error"
                            ? "bg-ui-danger"
                            : "bg-ui-accent",
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-bold">
                          {id ? nameOf(id) : "The world"}
                        </span>
                        <span className="text-[0.8125rem] text-ui-soft">
                          {finding.message}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}

type Run = MemoryRunsResponse["runs"][number];

/** One file of one night: only the lines that changed, added and taken out. */
function FileChange({ file }: { file: Run["files"][number] }) {
  const lines = changedOnly(diffLines(file.before ?? "", file.after ?? ""));
  const added = lines.filter((line) => line.kind === "added").length;
  const removed = lines.filter((line) => line.kind === "removed").length;
  return (
    <Fold
      value={file.path}
      title={file.path.replace(/^wiki\//, "").replace(/\.md$/, "")}
      summary={
        <span className="tabular-nums">
          <span className="text-ui-ok">{`+${added}`}</span>{" "}
          <span className="text-ui-danger">{`−${removed}`}</span>
        </span>
      }
    >
      <pre className="overflow-x-auto rounded-[0.875rem] bg-ui-ground p-3 font-[ui-monospace,monospace] text-xs leading-relaxed whitespace-pre-wrap">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cx(
              "-mx-1.5 rounded-[0.375rem] px-1.5",
              line.kind === "added" &&
                "bg-[color-mix(in_oklch,var(--ui-ok)_14%,transparent)]",
              line.kind === "removed" &&
                "text-ui-soft line-through decoration-ui-danger/60",
            )}
          >
            {line.kind === "added"
              ? "+ "
              : line.kind === "removed"
                ? "− "
                : "  "}
            {line.text}
          </div>
        ))}
      </pre>
    </Fold>
  );
}

/** Each night's sleep in a character's wiki, newest first, file by file. */
function Nights({ agent }: { agent: string }) {
  const runs = useMemoryRuns(agent);
  const { byId } = useCharacters();
  const called = firstName(byId.get(agent)?.name ?? agent);
  return (
    <Sheet label={`What each night changed for ${called}`}>
      <PageHead
        eyebrow={
          <span className="text-[0.8125rem] font-bold text-ui-accent-ink">{`${called}'s wiki`}</span>
        }
        title="Nights"
        under={
          <p className="max-w-prose text-[0.9375rem] text-ui-soft">
            What each night's sleep rewrote.
          </p>
        }
      />
      {runs.isLoading ? null : runs.error && !runs.data ? (
        <Note>{failureText(runs.error)}</Note>
      ) : !runs.data?.runs.length ? (
        <Note>{`${called} hasn't slept on anything yet.`}</Note>
      ) : (
        runs.data.runs.map((run, at) => (
          <section
            key={run.id}
            aria-label={formatSimTime(run.at)}
            style={{ animationDelay: `${Math.min(at, 6) * 50}ms` }}
            className="flex flex-col gap-2 motion-safe:animate-ui-rise"
          >
            <h2 className="flex items-baseline gap-2 text-[0.9375rem] font-extrabold">
              {formatSimTime(run.at)}
              <span className="text-xs font-bold text-ui-soft">
                {`${run.files.length} file${run.files.length === 1 ? "" : "s"}`}
              </span>
            </h2>
            <Folds>
              {run.files.map((file) => (
                <FileChange key={file.path} file={file} />
              ))}
            </Folds>
          </section>
        ))
      )}
    </Sheet>
  );
}
