"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  ArrowLeftRightIcon,
  EllipsisIcon,
  PowerIcon,
  PowerOffIcon,
  StarIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useOffstage, useStage } from "@/hooks/use-stage";
import { usePageLookup, usePageName, useWikiList } from "@/hooks/use-wiki";
import { NO_GROUP, nearestGroup } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { openPlayDialog } from "@/lib/state/ui-store";
import { IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { SearchInput } from "@/ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";
import { EmptySeats } from "@/ui/empty-seats";
import { Note } from "@/ui/note";
import { PackedGrid, PackedGroup, PackedTile } from "@/ui/packed-grid";
import { Portrait } from "@/ui/portrait";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { usePlainText, wikiParsers } from "../legacy";
import { wikiPatch } from "../wiki/open";
import { NO_FAVORITES } from "./favorites";
import { NewCharacterDialog } from "./new-character-dialog";
import {
  clearGalleryFocus,
  peekGalleryFocus,
  rememberGalleryFocus,
  useCastBook,
} from "./cast";
import { StageDialog, type StageRequest } from "./stage-dialog";
import { PRESENCE_TEXT, usePresence } from "./presence";
import {
  charactersParsers,
  profilePatch,
  type CastArrangement,
  type CastShow,
} from "./search-params";

type Show = "all" | CastShow;

/** A tile's least width, in px. */
const TILE = 124;

/**
 * Columns a group's name needs to read in two lines at most: a lone member of
 * the "Freight Logistics Department" shouldn't hold its name up in four.
 */
function headingSpan(label: string): number {
  return Math.max(1, Math.ceil(label.length / 28));
}

/**
 * Everyone in the world, face first, like a yearbook: by group or by name. A
 * card opens their profile; going back puts you on the card you left from.
 */
export function Gallery() {
  const { groups, cast, show, query, by } = useCastBook();
  const offstage = useOffstage();
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
    ...wikiParsers,
  });
  const { canManage, canPlay } = useAccess();
  const { apply: canStage } = useStage();
  const { characters } = useCharacters();
  const { data: pages } = useWikiList();
  const plain = usePlainText();
  const [creating, setCreating] = useState(false);
  const [castRequest, setStageRequest] = useState<StageRequest | null>(null);
  const [restoreId] = useState(() => peekGalleryFocus());
  const scrollRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef({ by, show });

  useEffect(() => {
    clearGalleryFocus();
  }, []);

  useEffect(() => {
    if (modeRef.current.by === by && modeRef.current.show === show) return;
    modeRef.current = { by, show };
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [by, show]);

  const groupPage = usePageLookup();
  const taken = useMemo(
    () =>
      new Set([
        ...(pages?.pages ?? []).map(({ id }) => id),
        ...characters.map(({ id }) => id.replace(/^user:/, "")),
      ]),
    [pages, characters],
  );
  const onstageCount = cast.filter((one) => !offstage.has(one.id)).length;

  const open = (id: string) => {
    rememberGalleryFocus(id);
    void setParams(profilePatch(id));
  };

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-1 max-md:px-4 max-md:pt-4">
        <div className="me-auto flex min-w-0 items-baseline gap-2">
          <h1 className="text-[1.375rem] font-extrabold">Characters</h1>
          <p className="text-sm font-bold text-ui-soft tabular-nums">
            {`${onstageCount} of ${cast.length} onstage`}
          </p>
        </div>
        <SearchInput
          className="w-60 flex-none bg-ui-ground max-sm:w-full"
          aria-label="Find a character or group"
          placeholder="Find by name or group"
          value={query}
          onChange={(e) =>
            void setParams(
              { "chars.q": e.target.value || null },
              { history: "replace" },
            )
          }
        />
        <Segmented<Show>
          aria-label="Show"
          value={show ?? "all"}
          onValueChange={(next) =>
            next &&
            void setParams(
              { "chars.show": next === "all" ? null : next },
              { history: "replace" },
            )
          }
        >
          <SegmentedItem value="all" className="max-sm:px-2">
            Everyone
          </SegmentedItem>
          <SegmentedItem value="onstage" className="max-sm:px-2">
            Onstage
          </SegmentedItem>
          <SegmentedItem value="offstage" className="max-sm:px-2">
            Offstage
          </SegmentedItem>
          <SegmentedItem value="favorites" className="max-sm:px-2">
            Favorites
          </SegmentedItem>
        </Segmented>
        <Segmented<CastArrangement>
          aria-label="Arrange"
          value={by}
          onValueChange={(next) =>
            next &&
            void setParams(
              { "chars.by": next === "group" ? null : next },
              { history: "replace" },
            )
          }
        >
          <SegmentedItem value="group" className="max-sm:px-2.5">
            Groups
          </SegmentedItem>
          <SegmentedItem value="name" className="max-sm:px-2.5">
            A–Z
          </SegmentedItem>
        </Segmented>
        {canManage || canStage || canPlay ? (
          <Menu>
            <MenuTrigger
              render={<IconButton label="More" tone="soft" size="md" />}
            >
              <EllipsisIcon aria-hidden />
            </MenuTrigger>
            <MenuContent>
              {canManage ? (
                <MenuItem
                  icon={<UserRoundPlusIcon aria-hidden />}
                  onSelect={() => setCreating(true)}
                >
                  New character
                </MenuItem>
              ) : null}
              {canStage ? (
                <MenuItem
                  icon={<PowerIcon aria-hidden />}
                  onSelect={() =>
                    setStageRequest({ label: "", cast, intent: "choose" })
                  }
                >
                  {"Who's onstage…"}
                </MenuItem>
              ) : null}
              {canPlay ? (
                <MenuItem
                  icon={<ArrowLeftRightIcon aria-hidden />}
                  onSelect={() => openPlayDialog()}
                >
                  Play as character…
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 max-md:px-4 max-md:pb-4"
      >
        {groups.length === 0 ? (
          <div className="flex flex-1 pt-6">
            {query.trim() ? (
              <Note>{`Nobody matches “${query.trim()}”.`}</Note>
            ) : show === "favorites" ? (
              <EmptySeats title="No favorites yet">{NO_FAVORITES}</EmptySeats>
            ) : show === "offstage" ? (
              <EmptySeats title="Nobody offstage">
                Everyone is onstage, thinking and acting.
              </EmptySeats>
            ) : show === "onstage" ? (
              <EmptySeats title="Nobody onstage">
                {canStage
                  ? "Bring people on from Who's onstage in the ⋯ menu."
                  : "Nobody is being simulated right now."}
              </EmptySeats>
            ) : (
              <EmptySeats title="No characters yet">
                {canManage
                  ? "New character in the ⋯ menu adds someone."
                  : "This world has nobody in it yet."}
              </EmptySeats>
            )}
          </div>
        ) : (
          <PackedGrid min={TILE}>
            {groups.map(({ key, label, members }) => {
              const named = by === "group" && key !== NO_GROUP;
              const page = named ? groupPage(key) : undefined;
              // The whole group, whatever the search or Show leaves showing.
              const everyone = named
                ? cast.filter((one) => nearestGroup(one) === key)
                : [];
              return (
                <PackedGroup
                  key={key}
                  label={label}
                  count={members.length}
                  minSpan={headingSpan(label)}
                  head={
                    <GroupHead
                      label={label}
                      letter={by === "name"}
                      summary={page?.summary ? plain(page.summary) : undefined}
                      count={members.length}
                      cast={
                        canStage && named
                          ? {
                              someOff: everyone.some((one) =>
                                offstage.has(one.id),
                              ),
                              someOn: everyone.some(
                                (one) => !offstage.has(one.id),
                              ),
                              onCast: (intent) =>
                                setStageRequest({
                                  label,
                                  cast: everyone,
                                  intent,
                                }),
                            }
                          : undefined
                      }
                    />
                  }
                >
                  {members.map((c) => (
                    <PackedTile key={c.id}>
                      <Card
                        character={c}
                        showGroup={by === "name"}
                        restoreFocus={restoreId === c.id}
                        onOpen={open}
                      />
                    </PackedTile>
                  ))}
                </PackedGroup>
              );
            })}
          </PackedGrid>
        )}
      </div>

      <NewCharacterDialog
        open={creating}
        onOpenChange={setCreating}
        existing={taken}
        onCharacter={(id) => void setParams(profilePatch(id))}
        onPage={(page) => {
          void setParams({
            ...wikiPatch(page.id, {
              edit: "world",
              kind: "person",
              name: page.name,
            }),
            character: null,
          });
          toast(`Writing ${page.name}'s page in the Wiki`, {
            description:
              "People who aren't simulated live in the Wiki, not in Characters.",
          });
        }}
      />
      <StageDialog
        request={castRequest}
        onOpenChange={(next) => (next ? null : setStageRequest(null))}
      />
    </div>
  );
}

/**
 * A group's name over its tiles, with a line of its summary when it has two or
 * more; a letter alone when arranged by name. For whoever runs the world a ⋯
 * sits beside the heading on hover without getting clipped by long names.
 */
function GroupHead({
  label,
  letter,
  summary,
  count,
  cast,
}: {
  label: string;
  letter: boolean;
  summary: string | undefined;
  count: number;
  cast?:
    | {
        someOff: boolean;
        someOn: boolean;
        onCast: (intent: "onstage" | "offstage") => void;
      }
    | undefined;
}) {
  const title = "text-[0.9375rem] leading-snug font-extrabold";
  if (letter)
    return (
      <h2 className={cx(title, "border-b border-ui-line pb-2")}>{label}</h2>
    );
  return (
    <div className="group/head relative border-b border-ui-line pb-2">
      {/* Two lines in all: the summary is clipped away when the name needs both. */}
      <div className="max-h-10 overflow-hidden">
        <h2 className={cx(title, "line-clamp-2 leading-5 text-balance")}>
          {label}
        </h2>
        {summary && count >= 2 ? (
          <p className="line-clamp-1 text-[0.8125rem] leading-5 text-ui-soft">
            {summary}
          </p>
        ) : null}
      </div>
      {cast ? (
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={`Onstage in ${label}`}
                className="absolute inset-e-0 top-0 grid size-5 place-items-center rounded-full bg-ui-surface/90 text-ui-soft opacity-0 shadow-ui backdrop-blur-xs transition-opacity group-hover/head:opacity-100 hover:bg-ui-tint hover:text-ui-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ui-primary pointer-coarse:opacity-100 data-open:bg-ui-tint data-open:opacity-100"
              />
            }
          >
            <EllipsisIcon aria-hidden className="size-3.5" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<PowerIcon aria-hidden />}
              disabled={!cast.someOff}
              onSelect={() => cast.onCast("onstage")}
            >
              Bring all onstage
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<PowerOffIcon aria-hidden />}
              disabled={!cast.someOn}
              onSelect={() => cast.onCast("offstage")}
            >
              Send all offstage
            </MenuItem>
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}

/**
 * Their face, name and one line: what they're doing if it's more than being
 * awake, or by name, their group. Nothing else, and nothing on hover: the card
 * does one thing, open them.
 */
const Card = memo(function Card({
  character,
  showGroup,
  restoreFocus,
  onOpen,
}: {
  character: CharacterSummary;
  showGroup: boolean;
  restoreFocus: boolean;
  onOpen: (id: string) => void;
}) {
  const { presence } = usePresence(character);
  const starred = useWatchlist().includes(character.id);
  const pageName = usePageName();
  const button = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!restoreFocus) return;
    button.current?.focus({ preventScroll: true });
    button.current?.scrollIntoView({ block: "center" });
  }, [restoreFocus]);

  const state = presence === "idle" ? "" : PRESENCE_TEXT[presence];
  const group =
    showGroup && character.groups?.[0] ? pageName(character.groups[0]) : "";
  return (
    <button
      ref={button}
      type="button"
      data-presence={presence}
      onClick={() => onOpen(character.id)}
      className="group/card flex w-full flex-col gap-2 rounded-[1rem] text-start outline-none"
    >
      <Portrait
        name={character.name}
        face={character.avatarUrl}
        presence={presence}
        className="aspect-square w-full rounded-[1rem] transition-[translate,box-shadow] duration-200 ease-[cubic-bezier(0.3,1.3,0.5,1)] group-hover/card:-translate-y-0.5 group-hover/card:shadow-ui group-focus-visible/card:outline-2 group-focus-visible/card:outline-offset-2 group-focus-visible/card:outline-ui-primary motion-reduce:transition-none"
      >
        {starred ? (
          <StarIcon
            aria-label="Favorite"
            className="absolute inset-e-2 top-2 size-4 fill-current text-ui-primary drop-shadow-sm"
          />
        ) : null}
      </Portrait>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[0.875rem] leading-tight font-bold">
          {character.name}
        </span>
        {state || group ? (
          <span
            className={
              state
                ? "truncate text-xs font-bold text-ui-accent-ink group-data-[presence=offstage]/card:text-ui-soft"
                : "truncate text-xs text-ui-soft"
            }
          >
            {state || group}
          </span>
        ) : null}
      </span>
    </button>
  );
});
