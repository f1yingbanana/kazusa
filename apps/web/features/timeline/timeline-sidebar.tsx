"use client";

import type { CharacterSummary } from "@kazusa/client";
import { StarIcon, UsersIcon, XIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { usePageName } from "@/hooks/use-wiki";
import { groupByNearest, matchesQuery } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { AvatarStack } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import { SearchInput } from "@/ui/input";
import { ListPane, ListPaneScroll, ListRow, ListRows } from "@/ui/list";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { ClubGroupItem } from "../characters/club-group-item";
import { timelineFilterParsers } from "./search-params";

/**
 * Who to follow in the Timeline: grouped by their clubs & circles with the same
 * generous row rhythm as World and Chats, plus one-click club selection and
 * zero layout jump when filtering.
 */
export function TimelineSidebar({ onNavigated }: { onNavigated?: () => void }) {
  const [params, setParams] = useQueryStates(timelineFilterParsers, {
    history: "replace",
  });
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { characters, byId } = useCharacters();
  const pageName = usePageName();
  const watchlist = useWatchlist();
  const favoriteSet = useMemo(() => new Set(watchlist), [watchlist]);

  const actors = params["tl.actors"];
  const actorSet = useMemo(() => new Set(actors), [actors]);
  const watchOnly = params["tl.watch"];
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const found = characters.filter(
      (c) =>
        !q ||
        matchesQuery(c, q) ||
        (c.groups ?? []).some((g) => pageName(g).toLowerCase().includes(q)),
    );
    return groupByNearest(found, pageName);
  }, [characters, pageName, q]);

  const activeGroup = useMemo(() => {
    if (!actors.length) return null;
    return (
      groups.find(
        (g) =>
          g.members.length === actors.length &&
          g.members.every((m) => actorSet.has(m.id)),
      ) ?? null
    );
  }, [groups, actors.length, actorSet]);

  const followingLabel = watchOnly
    ? "Favorites"
    : activeGroup
      ? activeGroup.label
      : actors.length === 1
        ? (byId.get(actors[0])?.name ?? actors[0])
        : actors.length > 1
          ? `${byId.get(actors[0])?.name ?? actors[0]} +${actors.length - 1}`
          : "Following everyone";

  const previewIds = watchOnly ? watchlist : actors;

  function focusGroup(members: readonly CharacterSummary[]) {
    const ids = members.map((m) => m.id);
    const sameSolo =
      !watchOnly &&
      ids.length === actors.length &&
      ids.every((id) => actorSet.has(id));
    void setParams({
      "tl.actors": sameSolo ? null : ids,
      "tl.watch": null,
    });
    if (!sameSolo) onNavigated?.();
  }

  function toggleGroupAdd(members: readonly CharacterSummary[]) {
    const ids = members.map((m) => m.id);
    const allIn = ids.every((id) => actorSet.has(id));
    const next = allIn
      ? actors.filter((id) => !ids.includes(id))
      : [...new Set([...actors, ...ids])];
    void setParams({
      "tl.actors": next.length ? next : null,
      "tl.watch": null,
    });
  }

  function focusPerson(id: string) {
    const solo = !watchOnly && actors.length === 1 && actors[0] === id;
    void setParams({
      "tl.actors": solo ? null : [id],
      "tl.watch": null,
    });
    if (!solo) onNavigated?.();
  }

  function togglePersonAdd(id: string) {
    const base = watchOnly ? watchlist : actors;
    const next = base.includes(id)
      ? base.filter((a) => a !== id)
      : [...base, id];
    void setParams({
      "tl.actors": next.length ? next : null,
      "tl.watch": null,
    });
  }

  function setExpanded(key: string, next: boolean) {
    setOpenGroups((prev) => ({ ...prev, [key]: next }));
  }

  return (
    <ListPane
      head={
        <SearchInput
          aria-label="Search cast and clubs"
          placeholder="Search cast & clubs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      }
    >
      {/* Fixed-height strip so selecting people or clubs never makes the list jump. */}
      <div className="mb-3 flex h-10 shrink-0 items-center gap-2 rounded-[1rem] bg-ui-surface px-2.5 inset-ring inset-ring-ui-line">
        {previewIds.length > 0 ? (
          <AvatarStack size="xs">
            {previewIds.slice(0, 3).map((id) => {
              const c = byId.get(id);
              return (
                <CharacterAvatar
                  key={id}
                  id={id}
                  name={c?.name ?? id}
                  avatarUrl={c?.avatarUrl}
                  kind={c?.kind}
                  size="xs"
                  decorative
                />
              );
            })}
          </AvatarStack>
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-primary [&_svg]:size-3.5">
            <UsersIcon aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-bold text-ui-ink">
          {followingLabel}
        </span>
        {actors.length > 0 || watchOnly ? (
          <IconButton
            size="sm"
            tone="ghost"
            label="Show everyone"
            onClick={() =>
              void setParams({ "tl.actors": null, "tl.watch": null })
            }
          >
            <XIcon aria-hidden />
          </IconButton>
        ) : null}
      </div>

      <ListPaneScroll>
        {groups.length === 0 ? (
          <Note inset="list">{`Nothing matches “${query}”.`}</Note>
        ) : (
          <div className="flex flex-col gap-3">
            {!q ? (
              <ListRows>
                <li>
                  <ListRow
                    current={actors.length === 0 && !watchOnly}
                    onClick={() => {
                      void setParams({ "tl.actors": null, "tl.watch": null });
                      onNavigated?.();
                    }}
                    leading={
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-primary [&_svg]:size-4.5">
                        <UsersIcon aria-hidden />
                      </span>
                    }
                    title="Everyone"
                    sub="The whole world at once"
                  />
                </li>
                {watchlist.length > 0 ? (
                  <li>
                    <ListRow
                      current={watchOnly}
                      onClick={() => {
                        void setParams({
                          "tl.watch": watchOnly ? null : true,
                          "tl.actors": null,
                        });
                        if (!watchOnly) onNavigated?.();
                      }}
                      leading={
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ui-accent-tint text-ui-accent-ink [&_svg]:size-4.5">
                          <StarIcon aria-hidden />
                        </span>
                      }
                      title="Favorites"
                      sub="Characters you starred"
                      trailing={
                        <AvatarStack size="xs">
                          {watchlist.slice(0, 3).map((id) => {
                            const c = byId.get(id);
                            return (
                              <CharacterAvatar
                                key={id}
                                id={id}
                                name={c?.name ?? id}
                                avatarUrl={c?.avatarUrl}
                                kind={c?.kind}
                                size="xs"
                                decorative
                              />
                            );
                          })}
                        </AvatarStack>
                      }
                    />
                  </li>
                ) : null}
              </ListRows>
            ) : null}

            <div
              className="flex flex-col gap-1.5"
              role="list"
              aria-label="Clubs and groups"
            >
              {groups.map((group) => {
                const selectedInGroup = group.members.filter((m) =>
                  actorSet.has(m.id),
                ).length;
                const allSelected =
                  selectedInGroup > 0 &&
                  selectedInGroup === group.members.length;
                const someSelected = selectedInGroup > 0 && !allSelected;
                const groupIsSoleFocus =
                  !watchOnly &&
                  allSelected &&
                  actorSet.size === group.members.length;
                return (
                  <ClubGroupItem
                    key={group.key}
                    group={group}
                    open={q ? true : Boolean(openGroups[group.key])}
                    onOpenChange={(next) => setExpanded(group.key, next)}
                    highlight={
                      groupIsSoleFocus
                        ? "sole"
                        : allSelected
                          ? "all"
                          : someSelected
                            ? "some"
                            : "none"
                    }
                    groupPressed={allSelected}
                    onPressGroup={() => focusGroup(group.members)}
                    groupAction={
                      actors.length > 0
                        ? {
                            active: allSelected,
                            label: allSelected
                              ? `Stop following ${group.label}`
                              : `Also follow ${group.label}`,
                            onToggle: () => toggleGroupAdd(group.members),
                          }
                        : undefined
                    }
                    memberState={(character) => {
                      const active =
                        actorSet.has(character.id) ||
                        (watchOnly && favoriteSet.has(character.id));
                      return {
                        current: active,
                        active,
                        actionLabel: active
                          ? `Stop following ${character.name}`
                          : `Also follow ${character.name}`,
                        onClick: () => focusPerson(character.id),
                        onToggle: () => togglePersonAdd(character.id),
                      };
                    }}
                    renderAvatar={(m, size) => (
                      <CharacterAvatar
                        id={m.id}
                        name={m.name}
                        avatarUrl={m.avatarUrl}
                        kind={m.kind}
                        size={size}
                        decorative
                      />
                    )}
                  />
                );
              })}
            </div>
          </div>
        )}
      </ListPaneScroll>
    </ListPane>
  );
}
