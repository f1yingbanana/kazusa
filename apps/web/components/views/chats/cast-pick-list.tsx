"use client";

import { useMemo, type ReactNode } from "react";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCast } from "@/hooks/use-characters";
import { useOffstage } from "@/hooks/use-stage";
import { cn } from "@/lib/utils";

/** Someone who can be picked to talk with. */
export interface CastPick {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly avatarUrl?: string;
  /** Why they can't be picked, under their name. */
  readonly busy?: string;
  readonly offstage?: boolean;
}

/**
 * The cast to pick from, but those in `leaving` (yourself, who is already
 * there): onstage first, then by name.
 */
export function useCastPicks(leaving: readonly string[]): readonly CastPick[] {
  const cast = useCast();
  const offstage = useOffstage();
  const key = leaving.join(" ");
  return useMemo(() => {
    const left = new Set(key.split(" "));
    return cast
      .filter((one) => !left.has(one.id))
      .map((one): CastPick => ({
        id: one.id,
        name: one.name,
        aliases: one.aliases,
        avatarUrl: one.avatarUrl,
        offstage: offstage.has(one.id),
      }))
      .toSorted((a, b) => Number(a.offstage) - Number(b.offstage));
  }, [cast, offstage, key]);
}

/**
 * Characters to pick any number of, searchable by name or alias: a tick on each
 * pick, offstage ones muted and marked. New chat and Add people share it.
 */
export function CastPickList({
  cast,
  picked,
  onToggle,
  placeholder,
  autoFocus,
  className,
  listClassName,
  leading,
  avatarSize = "xs",
  defaultValue,
}: {
  cast: readonly CastPick[];
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  listClassName?: string;
  /** Rows above the cast, such as Play as's Observer. */
  leading?: ReactNode;
  avatarSize?: "xs" | "sm";
  /** The row highlighted first. */
  defaultValue?: string;
}) {
  return (
    <Command className={className} defaultValue={defaultValue}>
      <CommandInput placeholder={placeholder} autoFocus={autoFocus} />
      <CommandList className={listClassName}>
        <CommandEmpty>Nobody by that name.</CommandEmpty>
        {leading}
        {cast.map((one) => (
          <CommandItem
            key={one.id}
            value={one.id}
            keywords={[one.name, ...(one.aliases ?? [])]}
            data-checked={picked.has(one.id)}
            aria-checked={picked.has(one.id)}
            disabled={Boolean(one.busy)}
            onSelect={() => onToggle(one.id)}
          >
            <PresenceAvatar
              id={one.id}
              name={one.name}
              avatarUrl={one.avatarUrl}
              kind="agent"
              size={avatarSize}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "truncate",
                  one.offstage && "text-muted-foreground",
                )}
              >
                {one.name}
              </span>
              {one.busy ? (
                <span className="truncate text-xs text-muted-foreground">
                  {one.busy}
                </span>
              ) : null}
            </span>
            {one.offstage ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                Offstage
              </span>
            ) : null}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
