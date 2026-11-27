"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useMemo, useState } from "react";
import type { WorldCharacter, WorldOption } from "@/lib/setup/setup";
import { groupByNearest, matchesQuery } from "@/lib/state/grouping";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { SearchInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { ClubGroupItem } from "../characters/club-group-item";
import { SetupCharacterCard } from "./character-card";

function toSummary(character: WorldCharacter): CharacterSummary {
  return {
    id: character.id,
    name: character.name,
    kind: "agent",
    aliases: [...(character.aliases ?? [])],
    ...(character.summary ? { summary: character.summary } : {}),
    ...(character.avatarUrl ? { avatarUrl: character.avatarUrl } : {}),
    ...(character.groups ? { groups: [...character.groups] } : {}),
  };
}

function setsEqual(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/**
 * Who starts active when the world first opens: grouped by club/circle (reusing
 * Timeline's `ClubGroupItem` and FLIP avatar stacks) beside a preview card.
 */
export function CastPicker({
  world,
  cast,
  onChange,
}: {
  world: WorldOption;
  cast: ReadonlySet<string>;
  onChange: (cast: ReadonlySet<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const groupNames = useMemo(() => world.groupNames ?? {}, [world.groupNames]);

  const summaries = useMemo(
    () => world.characters.map(toSummary),
    [world.characters],
  );
  const byId = useMemo(
    () => new Map(world.characters.map((c) => [c.id, c])),
    [world.characters],
  );

  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const filtered = summaries.filter(
      (c) =>
        !q ||
        matchesQuery(c, q) ||
        (c.groups ?? []).some((g) =>
          (groupNames[g] ?? g).toLowerCase().includes(q),
        ),
    );
    return groupByNearest(filtered, (id) => groupNames[id] ?? id);
  }, [summaries, groupNames, q]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (world.defaultCast.length > 0) {
      const defaults = new Set(world.defaultCast);
      for (const group of groups) {
        if (group.members.some((m) => defaults.has(m.id)))
          initial[group.key] = true;
      }
    }
    if (Object.keys(initial).length === 0 && groups[0])
      initial[groups[0].key] = true;
    return initial;
  });

  const [inspectedId, setInspectedId] = useState<string | undefined>(
    () => world.defaultCast[0] ?? world.characters[0]?.id,
  );
  const inspected =
    (inspectedId ? byId.get(inspectedId) : undefined) ??
    (world.defaultCast[0] ? byId.get(world.defaultCast[0]) : undefined) ??
    world.characters[0];

  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(cast);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  const allIds = useMemo(
    () => world.characters.map(({ id }) => id),
    [world.characters],
  );
  const isDefault =
    world.defaultCast.length > 0 && setsEqual(cast, world.defaultCast);
  const isAll = allIds.length > 0 && cast.size === allIds.length;
  const inspectedOn = inspected ? cast.has(inspected.id) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1.5">
        <div className="w-full min-w-0 sm:flex-1">
          <SearchInput
            aria-label="Search characters and groups"
            placeholder={`Search ${world.characters.length} characters & groups`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-ui-ground"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {world.defaultCast.length > 0 ? (
            <Button
              size="sm"
              tone={isDefault ? "primary" : "soft"}
              onClick={() => onChange(new Set(world.defaultCast))}
            >
              Recommended
            </Button>
          ) : null}
          <Button
            size="sm"
            tone={isAll ? "primary" : "ghost"}
            onClick={() => onChange(new Set(allIds))}
          >
            All
          </Button>
          <Button
            size="sm"
            tone="ghost"
            disabled={cast.size === 0}
            onClick={() => onChange(new Set())}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_19rem] sm:gap-4">
        <div
          role="list"
          aria-label="Groups"
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 sm:h-full"
        >
          {groups.length === 0 ? (
            <Note inset="list">{`Nothing matches “${search}”.`}</Note>
          ) : (
            groups.map((group) => {
              const selectedCount = group.members.filter((m) =>
                cast.has(m.id),
              ).length;
              const allSelected =
                selectedCount > 0 && selectedCount === group.members.length;
              const someSelected = selectedCount > 0 && !allSelected;
              return (
                <ClubGroupItem
                  key={group.key}
                  group={group}
                  open={q ? true : Boolean(openGroups[group.key])}
                  onOpenChange={(next) =>
                    setOpenGroups((prev) => ({ ...prev, [group.key]: next }))
                  }
                  highlight={
                    allSelected ? "all" : someSelected ? "some" : "none"
                  }
                  currentStyle="tint"
                  groupAction={{
                    active: allSelected,
                    label: allSelected
                      ? `Remove ${group.label}`
                      : `Select ${group.label}`,
                    onToggle: () =>
                      toggle(
                        group.members.map((m) => m.id),
                        !allSelected,
                      ),
                  }}
                  memberState={(character) => {
                    const active = cast.has(character.id);
                    return {
                      current: inspected?.id === character.id,
                      active,
                      dim: !active,
                      actionLabel: active
                        ? `Remove ${character.name}`
                        : `Add ${character.name}`,
                      onClick: () => setInspectedId(character.id),
                      onToggle: () => {
                        toggle([character.id], !active);
                        setInspectedId(character.id);
                      },
                    };
                  }}
                  renderAvatar={(member, size) => (
                    <Avatar
                      name={member.name}
                      src={member.avatarUrl}
                      size={size}
                      decorative
                    />
                  )}
                />
              );
            })
          )}
        </div>

        <SetupCharacterCard
          character={inspected}
          groupNames={groupNames}
          className="shrink-0 sm:h-full sm:overflow-y-auto"
          action={
            inspected ? (
              <Button
                size="sm"
                tone={inspectedOn ? "soft" : "primary"}
                className="hidden sm:inline-flex"
                onClick={() => toggle([inspected.id], !inspectedOn)}
              >
                {inspectedOn ? "Remove" : "Add"}
              </Button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
