"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  CheckIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { usePageName } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { groupByNearest, matchesQuery, type Group } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { avatarCountClass, AvatarStack } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/ui/collapsible";
import { cx } from "@/ui/cx";
import { SearchInput } from "@/ui/input";
import { ListPane, ListPaneScroll, ListRow, ListRows } from "@/ui/list";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { timelineFilterParsers } from "./search-params";

/**
 * Who to follow in the Timeline: grouped by their clubs & circles with the
 * same generous row rhythm as World and Chats, plus one-click club selection
 * and zero layout jump when filtering.
 */
export function TimelineSidebar({
  onNavigated,
}: {
  onNavigated?: () => void;
}) {
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
    const next = actorSet.has(id)
      ? actors.filter((a) => a !== id)
      : [...actors, id];
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
              {groups.map((group) => (
                <ClubItem
                  key={group.key}
                  group={group}
                  actorSet={actorSet}
                  hasActiveSelection={actors.length > 0}
                  watchOnly={watchOnly}
                  favoriteSet={favoriteSet}
                  open={q ? true : Boolean(openGroups[group.key])}
                  onOpenChange={(next) => setExpanded(group.key, next)}
                  onFocusGroup={() => focusGroup(group.members)}
                  onToggleGroupAdd={() => toggleGroupAdd(group.members)}
                  onFocusPerson={focusPerson}
                  onTogglePersonAdd={togglePersonAdd}
                />
              ))}
            </div>
          </div>
        )}
      </ListPaneScroll>
    </ListPane>
  );
}

interface FlipSnapshot {
  readonly rect: DOMRect;
  readonly clone: HTMLElement;
}

function ClubItem({
  group,
  actorSet,
  hasActiveSelection,
  watchOnly,
  favoriteSet,
  open,
  onOpenChange,
  onFocusGroup,
  onToggleGroupAdd,
  onFocusPerson,
  onTogglePersonAdd,
}: {
  group: Group;
  actorSet: ReadonlySet<string>;
  hasActiveSelection: boolean;
  watchOnly: boolean;
  favoriteSet: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusGroup: () => void;
  onToggleGroupAdd: () => void;
  onFocusPerson: (id: string) => void;
  onTogglePersonAdd: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stripAvatarRefs = useRef(new Map<string, HTMLSpanElement>());
  const stripOverflowRef = useRef<HTMLSpanElement>(null);
  const rowAvatarRefs = useRef(new Map<string, HTMLSpanElement>());
  const pendingFlip = useRef<{
    dir: "expand" | "collapse";
    snapshots: Map<string, FlipSnapshot>;
    overflowRect?: DOMRect;
  } | null>(null);

  const selectedInGroup = group.members.filter((m) => actorSet.has(m.id)).length;
  const allSelected =
    selectedInGroup > 0 && selectedInGroup === group.members.length;
  const someSelected = selectedInGroup > 0 && !allSelected;
  const groupIsSoleFocus =
    !watchOnly && allSelected && actorSet.size === group.members.length;
  const memberPreview = group.members.map((m) => firstName(m.name)).join(", ");
  const overflow = group.members.length >= 5 ? group.members.length - 3 : 0;
  const stripMembers = overflow > 0 ? group.members.slice(0, 3) : group.members;

  function captureAndToggle(nextOpen: boolean) {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && typeof Element.prototype.animate === "function") {
      const source = nextOpen ? stripAvatarRefs.current : rowAvatarRefs.current;
      const snapshots = new Map<string, FlipSnapshot>();
      for (const [id, el] of source) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          snapshots.set(id, {
            rect,
            clone: el.cloneNode(true) as HTMLElement,
          });
        }
      }
      const overflowRect = nextOpen
        ? stripOverflowRef.current?.getBoundingClientRect()
        : undefined;
      if (snapshots.size > 0) {
        pendingFlip.current = {
          dir: nextOpen ? "expand" : "collapse",
          snapshots,
          overflowRect:
            overflowRect && overflowRect.width > 0 ? overflowRect : undefined,
        };
      }
    }
    onOpenChange(nextOpen);
  }

  useLayoutEffect(() => {
    const flip = pendingFlip.current;
    pendingFlip.current = null;
    const root = rootRef.current;
    if (!flip || !root) return;
    if (flip.dir === "expand" && !open) return;
    if (flip.dir === "collapse" && open) return;

    const rootRect = root.getBoundingClientRect();
    const targets =
      flip.dir === "expand" ? rowAvatarRefs.current : stripAvatarRefs.current;
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "pointer-events-none absolute inset-0 z-20";
    root.appendChild(overlay);

    const hiddenElements: HTMLSpanElement[] = [];
    const animations: Animation[] = [];

    // Hide the portraits inside closing rows immediately so they visibly lift out.
    if (flip.dir === "collapse") {
      for (const sourceEl of rowAvatarRefs.current.values()) {
        sourceEl.style.opacity = "0";
        hiddenElements.push(sourceEl);
      }
    }

    const overflowTargetRect =
      flip.dir === "collapse"
        ? stripOverflowRef.current?.getBoundingClientRect()
        : undefined;

    let index = 0;
    for (const [id, { rect: fromRect, clone }] of flip.snapshots) {
      const target = targets.get(id);
      const targetRect = target?.getBoundingClientRect();
      const hasDirectTarget =
        Boolean(target && targetRect && targetRect.width > 0);
      const toRect = hasDirectTarget
        ? targetRect
        : flip.dir === "collapse" &&
            overflowTargetRect &&
            overflowTargetRect.width > 0
          ? overflowTargetRect
          : undefined;

      if (!toRect) continue;

      if (hasDirectTarget && target) {
        target.style.opacity = "0";
        hiddenElements.push(target);
      }

      clone.style.position = "absolute";
      clone.style.left = `${fromRect.left - rootRect.left}px`;
      clone.style.top = `${fromRect.top - rootRect.top}px`;
      clone.style.width = `${fromRect.width}px`;
      clone.style.height = `${fromRect.height}px`;
      clone.style.margin = "0";
      clone.style.transformOrigin = "top left";
      overlay.appendChild(clone);

      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      const scale = toRect.width / fromRect.width;

      const anim = clone.animate(
        hasDirectTarget
          ? [
              { transform: "translate(0px, 0px) scale(1)" },
              { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
            ]
          : [
              { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
              {
                transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
                opacity: 0,
              },
            ],
        {
          duration: 200,
          delay: index * 8,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
      anim.onfinish = () => {
        if (hasDirectTarget && target) target.style.opacity = "";
        clone.remove();
      };
      animations.push(anim);
      index += 1;
    }

    // Overflow members (+N) also burst cleanly from the +N badge on expand.
    if (flip.dir === "expand" && flip.overflowRect) {
      for (const [id, target] of targets) {
        if (flip.snapshots.has(id)) continue;
        const toRect = target.getBoundingClientRect();
        if (toRect.width === 0) continue;
        const clone = target.cloneNode(true) as HTMLElement;
        target.style.opacity = "0";
        hiddenElements.push(target);

        const fromRect = flip.overflowRect;
        clone.style.position = "absolute";
        clone.style.left = `${fromRect.left - rootRect.left}px`;
        clone.style.top = `${fromRect.top - rootRect.top}px`;
        clone.style.width = `${toRect.width}px`;
        clone.style.height = `${toRect.height}px`;
        clone.style.margin = "0";
        clone.style.transformOrigin = "top left";
        overlay.appendChild(clone);

        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;
        const startScale = fromRect.height / toRect.height;

        const anim = clone.animate(
          [
            {
              transform: `translate(0px, 0px) scale(${startScale})`,
              opacity: 0,
            },
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
          ],
          {
            duration: 200,
            delay: index * 8,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        );
        anim.onfinish = () => {
          target.style.opacity = "";
          clone.remove();
        };
        animations.push(anim);
        index += 1;
      }
    }

    if (animations.length === 0) {
      for (const el of hiddenElements) el.style.opacity = "";
      overlay.remove();
      return;
    }

    return () => {
      for (const anim of animations) anim.cancel();
      for (const el of hiddenElements) el.style.opacity = "";
      overlay.remove();
    };
  }, [open]);

  return (
    <div ref={rootRef} role="listitem" className="relative flex flex-col">
      <Collapsible
        open={open}
        onOpenChange={captureAndToggle}
        className="flex flex-col"
      >
        <div
          className={cx(
            "flex items-center gap-1.5 rounded-[1rem] px-1.5 transition-colors duration-150",
            groupIsSoleFocus
              ? "bg-ui-surface inset-ring-2 inset-ring-ui-primary"
              : allSelected
                ? "bg-ui-surface inset-ring inset-ring-ui-primary/50"
                : someSelected
                  ? "bg-ui-tint/70"
                  : "hover:bg-ui-tint/70",
          )}
        >
          <CollapsibleTrigger
            aria-label={`Show people in ${group.label}`}
            className="group/club grid size-7 shrink-0 place-items-center rounded-full text-ui-soft transition-colors duration-150 hover:bg-ui-surface hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary"
          >
            <ChevronRightIcon
              aria-hidden
              className="size-4 transition-transform duration-200 group-aria-expanded/club:rotate-90 rtl:rotate-180"
            />
          </CollapsibleTrigger>

          <button
            type="button"
            aria-pressed={allSelected}
            className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[0.875rem] py-2.5 pe-2 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary"
            onClick={onFocusGroup}
          >
            <span className="truncate text-[0.9375rem] leading-tight font-bold text-ui-ink">
              {group.label}
            </span>
            <span className="flex h-5 items-center overflow-hidden">
              <span
                className={cx(
                  "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,margin] duration-200 motion-reduce:transition-none",
                  open
                    ? "me-0 max-w-0 opacity-0"
                    : "me-2 max-w-28 opacity-100",
                )}
              >
                <AvatarStack size="xs">
                  {stripMembers.map((m) => (
                    <span
                      key={m.id}
                      ref={(el) => {
                        if (el) stripAvatarRefs.current.set(m.id, el);
                        else stripAvatarRefs.current.delete(m.id);
                      }}
                      className="inline-flex shrink-0"
                    >
                      <CharacterAvatar
                        id={m.id}
                        name={m.name}
                        avatarUrl={m.avatarUrl}
                        kind={m.kind}
                        size="xs"
                        decorative
                      />
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span
                      ref={stripOverflowRef}
                      aria-hidden="true"
                      className={cx("relative", avatarCountClass("xs"))}
                    >
                      {`+${overflow}`}
                    </span>
                  ) : null}
                </AvatarStack>
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ui-soft">
                {memberPreview}
              </span>
            </span>
          </button>

          {hasActiveSelection ? (
            <IconButton
              size="sm"
              tone="ghost"
              className={
                allSelected
                  ? "bg-ui-primary/14 text-ui-primary hover:bg-ui-primary/22"
                  : undefined
              }
              label={
                allSelected
                  ? `Stop following ${group.label}`
                  : `Also follow ${group.label}`
              }
              onClick={onToggleGroupAdd}
            >
              {allSelected ? (
                <CheckIcon aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
            </IconButton>
          ) : null}
        </div>

        <CollapsiblePanel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <ul className="relative ms-5 mt-1 flex flex-col gap-1 ps-2.5 pe-1.5 pb-1.5 before:absolute before:inset-y-1 before:inset-s-0 before:w-px before:bg-ui-line">
            {group.members.map((character) => {
              const active =
                actorSet.has(character.id) ||
                (watchOnly && favoriteSet.has(character.id));
              return (
                <li key={character.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-start text-sm font-semibold text-ui-ink transition-colors duration-150 hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-ui-primary aria-current:bg-ui-surface aria-current:font-bold aria-current:text-ui-primary"
                    onClick={() => onFocusPerson(character.id)}
                  >
                    <span
                      ref={(el) => {
                        if (el) rowAvatarRefs.current.set(character.id, el);
                        else rowAvatarRefs.current.delete(character.id);
                      }}
                      className="inline-flex shrink-0"
                    >
                      <CharacterAvatar
                        id={character.id}
                        name={character.name}
                        avatarUrl={character.avatarUrl}
                        kind={character.kind}
                        size="sm"
                        decorative
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {character.name}
                    </span>
                  </button>
                  <IconButton
                    size="sm"
                    tone="ghost"
                    className={
                      actorSet.has(character.id)
                        ? "bg-ui-primary/14 text-ui-primary hover:bg-ui-primary/22"
                        : undefined
                    }
                    label={
                      actorSet.has(character.id)
                        ? `Stop following ${character.name}`
                        : `Also follow ${character.name}`
                    }
                    onClick={() => onTogglePersonAdd(character.id)}
                  >
                    {actorSet.has(character.id) ? (
                      <MinusIcon aria-hidden />
                    ) : (
                      <PlusIcon aria-hidden />
                    )}
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
