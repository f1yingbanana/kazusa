"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterSummary } from "@kazusa/client";
import { toast } from "sonner";
import {
  ArrowLeftRightIcon,
  EllipsisIcon,
  ListFilterIcon,
  MenuIcon,
  PowerIcon,
  PowerOffIcon,
  UserRoundPlusIcon,
  UsersRoundIcon,
} from "lucide-react";
import {
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
} from "nuqs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { TASK_ORDER, taskLabel } from "@/components/entities/task-icon";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Unavailable } from "@/components/entities/source-state";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { usePageName, usePlainText } from "@/components/views/wiki/page-link";
import { useAccess } from "@/hooks/use-access";
import { useWikiList } from "@/hooks/use-wiki";
import { NewPageDialog } from "@/components/views/wiki/new-page-dialog";
import { WorldPage } from "@/components/views/wiki/wiki-view";
import { wikiParsers } from "@/components/views/wiki/search-params";
import {
  useCast,
  useCharacterStatus,
  useCharacters,
} from "@/hooks/use-characters";
import { useOffstage, useStage } from "@/hooks/use-stage";
import { useLiveStore } from "@/lib/live/state";
import { needsHan, type HanInitial } from "@/lib/state/name-index";
import {
  groupByActivity,
  groupByLetter,
  groupByStatus,
  groupByNearest,
  matchesQuery,
  nearestGroup,
  NO_GROUP,
} from "@/lib/state/grouping";
import { CastDialog, type CastRequest } from "./cast-dialog";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { useSources } from "@/lib/source/provider";
import { openPlayDialog, requestSidebar } from "@/lib/state/ui-store";
import { cn } from "@/lib/utils";

const characterParser = parseAsString;

/** The keys a character's tabs reset when one is opened. */
const PAGE_START = {
  "wiki.part": null,
  "wiki.edit": null,
  "wiki.raw": null,
  "wiki.kind": null,
  "wiki.name": null,
} as const;

/** Who the list shows, and how it heads them. Defaults: everyone, by group. */
const rosterParsers = {
  "chars.show": parseAsStringLiteral(["onstage", "offstage"]),
  "chars.by": parseAsStringLiteral(["name", "activity", "status"]),
};

/**
 * Chinese characters' readings, for headings by name: the dictionary loads only
 * once a name needs it.
 */
function useHanInitial(
  cast: readonly CharacterSummary[],
  wanted: boolean,
): HanInitial | undefined {
  const needed = wanted && needsHan(cast.map(({ name }) => name));
  const [han, setHan] = useState<HanInitial>();
  useEffect(() => {
    if (!needed || han) return;
    let live = true;
    void import("pinyin-pro").then(({ pinyin }) => {
      if (live)
        setHan(
          () => (character: string) =>
            pinyin(character, { pattern: "first", toneType: "none" }),
        );
    });
    return () => {
      live = false;
    };
  }, [needed, han]);
  return han;
}

/**
 * The cast like a contact list: by group (each heading stays in view while its
 * people scroll under it, with the group's onstage menu) or by first letter.
 * Offstage characters show greyed avatars.
 */
export function CharactersSidebar({ onNavigated }: SectionSidebarProps) {
  const cast = useCast();
  const [selected, setSelected] = useQueryState("character", characterParser);
  const [, setView] = useQueryStates({
    view: parseAsString,
    character: characterParser,
  });
  const [{ "chars.show": show, "chars.by": by }, setRoster] =
    useQueryStates(rosterParsers);
  const [, setWiki] = useQueryStates(wikiParsers);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [castRequest, setCastRequest] = useState<CastRequest | null>(null);
  const { canManage, canPlay } = useAccess();
  const { apply: canStage } = useStage();
  const offstage = useOffstage();
  const statuses = useLiveStore((state) => state.statuses);
  const { characters } = useCharacters();
  const { data: pages } = useWikiList();
  const nameOf = usePageName();
  // Ids already taken: every page in the World Wiki and every character.
  const taken = useMemo(
    () =>
      new Set([
        ...(pages?.pages ?? []).map(({ id }) => id),
        ...characters.map(({ id }) => id.replace(/^user:/, "")),
      ]),
    [pages, characters],
  );
  const plain = usePlainText();

  const han = useHanInitial(cast, by === "name");
  const needle = query.trim().toLowerCase();
  const pool = cast.filter(
    (one) =>
      (!show || offstage.has(one.id) === (show === "offstage")) &&
      (!needle ||
        matchesQuery(one, needle) ||
        plain(one.summary ?? "")
          .toLowerCase()
          .includes(needle) ||
        (one.groups ?? []).some((group) =>
          nameOf(group).toLowerCase().includes(needle),
        )),
  );
  const groups =
    by === "name"
      ? groupByLetter(pool, han)
      : by === "activity"
        ? groupByActivity(pool, (id) => statuses.get(id), TASK_ORDER, taskLabel)
        : by === "status"
          ? groupByStatus(pool, (id) => statuses.get(id))
          : groupByNearest(pool, nameOf);

  const open = useCallback(
    (id: string) => {
      void setSelected(id);
      // A character's tabs start on their page.
      void setWiki(PAGE_START);
      onNavigated?.();
    },
    [setSelected, setWiki, onNavigated],
  );
  const filtered = Boolean(show || by);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={`Search ${cast.length} characters`}
        label="Search characters"
        leading={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="relative" />
              }
            >
              <ListFilterIcon />
              {filtered ? (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
                />
              ) : null}
              <span className="sr-only">
                {filtered ? "Show and sort (changed)" : "Show and sort"}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto max-w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={show ?? "all"}
                  onValueChange={(value: string) =>
                    void setRoster({
                      "chars.show":
                        value === "onstage" || value === "offstage"
                          ? value
                          : null,
                    })
                  }
                >
                  <DropdownMenuRadioItem value="all">
                    Everyone
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="onstage">
                    Onstage
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="offstage">
                    Offstage
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Group by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={by ?? "group"}
                  onValueChange={(value: string) =>
                    void setRoster({
                      "chars.by":
                        value === "name" ||
                        value === "activity" ||
                        value === "status"
                          ? value
                          : null,
                    })
                  }
                >
                  <DropdownMenuRadioItem value="group">
                    Group
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="name">
                    Name
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="activity">
                    Activity
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="status">
                    Status
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {canManage || canStage || canPlay ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <EllipsisIcon />
              <span className="sr-only">More</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto max-w-64">
              {canManage ? (
                <DropdownMenuItem onClick={() => setCreating(true)}>
                  <UserRoundPlusIcon />
                  New character
                </DropdownMenuItem>
              ) : null}
              {canStage ? (
                <DropdownMenuItem
                  onClick={() =>
                    setCastRequest({ label: "", cast, intent: "choose" })
                  }
                >
                  <PowerIcon />
                  Stage character
                </DropdownMenuItem>
              ) : null}
              {canPlay ? (
                <DropdownMenuItem onClick={() => openPlayDialog()}>
                  <ArrowLeftRightIcon />
                  Play as character
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </PanelToolbar>
      <NewPageDialog
        open={creating}
        onOpenChange={setCreating}
        whose="the World Wiki"
        existing={taken}
        person
        onCharacter={(id) => {
          void setSelected(id);
          void setWiki({
            "wiki.part": null,
            "wiki.edit": "world",
            "wiki.raw": null,
          });
          onNavigated?.();
        }}
        onCreate={(page) => {
          // Not simulated, they're a page: written in the Wiki, not here.
          void setView({ view: "wiki", character: null });
          void setWiki({
            "wiki.page": page.id,
            "wiki.agent": null,
            "wiki.tab": null,
            "wiki.part": null,
            "wiki.edit": "world",
            "wiki.kind": page.kind,
            "wiki.name": page.name,
          });
          toast(`Writing ${page.name}'s page in the Wiki`, {
            description:
              "People who aren't simulated live in the Wiki, not in Characters.",
          });
          onNavigated?.();
        }}
      />
      <CastDialog
        request={castRequest}
        onOpenChange={(next) => (next ? null : setCastRequest(null))}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => {
          // The whole group, whatever the search or filter leaves showing.
          const everyone = by
            ? group.members
            : cast.filter((one) => nearestGroup(one) === group.key);
          const someOff = everyone.some((one) => offstage.has(one.id));
          const someOn = everyone.some((one) => !offstage.has(one.id));
          return (
            <section key={group.key} aria-label={group.label}>
              <GroupHeading
                label={group.label}
                // Only real groups: letters and activities aren't people
                // anyone would bring on together.
                onCast={
                  canStage && !by
                    ? (intent) =>
                        setCastRequest({
                          label:
                            group.key === NO_GROUP
                              ? "everyone without a group"
                              : group.label,
                          cast: everyone,
                          intent,
                        })
                    : undefined
                }
                canBringOn={someOff}
                canSendOff={someOn}
              />
              <ul>
                {group.members.map((one) => (
                  <li key={one.id}>
                    <RosterRow
                      character={one}
                      selected={selected === one.id}
                      onOpen={open}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!groups.length ? (
          <div className="flex flex-col items-start gap-1 px-2 py-4 text-sm text-muted-foreground">
            <p>{needle || show ? "No one matches." : "No characters yet."}</p>
            {show ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => void setRoster({ "chars.show": null })}
              >
                Show everyone
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A group's name, pinned while its people scroll, with the group's onstage menu
 * always there (headings are few, so it never crowds).
 */
function GroupHeading({
  label,
  onCast,
  canBringOn,
  canSendOff,
}: {
  label: string;
  onCast?: (intent: "onstage" | "offstage") => void;
  canBringOn: boolean;
  canSendOff: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center gap-1 bg-sidebar pr-0.5 pl-2">
      <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      {onCast ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
              />
            }
          >
            <EllipsisIcon />
            <span className="sr-only">{`Onstage for ${label}`}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto max-w-64">
            <DropdownMenuItem
              disabled={!canBringOn}
              onClick={() => onCast("onstage")}
            >
              <PowerIcon />
              Bring all onstage
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canSendOff}
              onClick={() => onCast("offstage")}
            >
              <PowerOffIcon />
              Send all offstage
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * Name and one line: what they're doing now when onstage, else who they are.
 * The avatar greys out offstage.
 */
const RosterRow = memo(function RosterRow({
  character,
  selected,
  onOpen,
}: {
  character: CharacterSummary;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const plain = usePlainText();
  const status = useCharacterStatus(character.id);
  const { player, watching } = useSources();
  const task = status?.onstage === false ? undefined : status?.task;
  const line =
    task?.description ?? (character.summary ? plain(character.summary) : null);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "bg-accent text-accent-foreground",
      )}
      onClick={() => onOpen(character.id)}
    >
      <PresenceAvatar
        id={character.id}
        name={character.name}
        avatarUrl={character.avatarUrl}
        kind={character.kind}
        size="md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{character.name}</span>
          {status?.playedBy ? (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] leading-4 font-medium text-primary">
              {!watching && player.id === character.id ? "You" : "Played"}
            </span>
          ) : null}
        </span>
        {line ? (
          <span className="truncate text-xs text-muted-foreground">{line}</span>
        ) : null}
      </span>
    </button>
  );
});

/** One character: who they are, their memory, looks and stickers. */
export function CharactersView() {
  const { resolved } = useSources();
  const [selected] = useQueryState("character", characterParser);
  if (resolved.wiki !== "live")
    return <Unavailable requires={["wiki"]} className="m-auto" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:hidden">
        <Button variant="outline" size="sm" onClick={requestSidebar}>
          <MenuIcon />
          Characters
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <WorldPage key={selected} id={selected} />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRoundIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a character</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
