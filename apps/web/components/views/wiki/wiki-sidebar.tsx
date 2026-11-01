"use client";

import { useMemo, useState } from "react";
import { AlertTriangleIcon, MoonIcon } from "lucide-react";
import type { WikiKind, WikiListItem } from "@kazusa/client";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { useCharacters } from "@/hooks/use-characters";
import { useNavigate, useParam } from "@/hooks/use-url-state";
import { useWikiLint, useWikiList } from "@/hooks/use-wiki";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { cn } from "@/lib/utils";

const GROUPS: ReadonlyArray<{
  readonly kind: WikiKind;
  readonly label: string;
}> = [
  { kind: "person", label: "People" },
  { kind: "place", label: "Places" },
  { kind: "concept", label: "Things" },
  { kind: "day", label: "Diary" },
];

/** Pick a wiki (the world's, or one character's mind), then a page in it. */
export function WikiSidebar({ onNavigated }: SectionSidebarProps) {
  const agent = useParam("wiki.agent") ?? undefined;
  const open = useParam("wiki.page");
  const tab = useParam("wiki.tab");
  const navigate = useNavigate();
  const { characters } = useCharacters();
  const { data } = useWikiList(agent);
  const { data: lint } = useWikiLint(agent);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = (data?.pages ?? []).filter(
      (page: WikiListItem) =>
        !needle ||
        page.name.toLowerCase().includes(needle) ||
        page.summary.toLowerCase().includes(needle),
    );
    return GROUPS.map((group) => ({
      ...group,
      pages: matching
        .filter((page: WikiListItem) => page.kind === group.kind)
        .sort((a: WikiListItem, b: WikiListItem) =>
          // The newest day first; everything else by name.
          group.kind === "day"
            ? b.id.localeCompare(a.id)
            : a.name.localeCompare(b.name),
        ),
    })).filter((group) => group.pages.length > 0);
  }, [data, query]);

  const go = (patch: Readonly<Record<string, string | null>>) => {
    navigate(patch);
    onNavigated?.();
  };
  const problems = lint?.findings.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pt-2">
        <label className="sr-only" htmlFor="wiki-agent">
          Whose wiki
        </label>
        <select
          id="wiki-agent"
          value={agent ?? ""}
          onChange={(event) =>
            go({ "wiki.agent": event.target.value || null, "wiki.tab": null })
          }
          className="h-8 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="">The world</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </div>
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={`Search ${data?.pages.length ?? 0} pages`}
        label="Search pages"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <section key={group.kind} className="mb-3">
            <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </h3>
            {group.pages.map((page: WikiListItem) => (
              <button
                key={page.id}
                type="button"
                onClick={() => go({ "wiki.page": page.id, "wiki.tab": null })}
                className={cn(
                  "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent/70",
                  open === page.id && !tab && "bg-sidebar-accent",
                )}
              >
                {page.name}
              </button>
            ))}
          </section>
        ))}
      </div>
      <div className="shrink-0 border-t p-2">
        {agent ? (
          <button
            type="button"
            onClick={() => go({ "wiki.tab": "nights" })}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent/70",
              tab === "nights" && "bg-sidebar-accent",
            )}
          >
            <MoonIcon aria-hidden className="size-4 text-muted-foreground" />
            What each night changed
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => go({ "wiki.tab": "lint" })}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent/70",
            tab === "lint" && "bg-sidebar-accent",
          )}
        >
          <AlertTriangleIcon
            aria-hidden
            className="size-4 text-muted-foreground"
          />
          <span className="flex-1 text-left">Problems</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {problems}
          </span>
        </button>
      </div>
    </div>
  );
}
