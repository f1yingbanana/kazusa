"use client";

import type { ReactNode } from "react";
import type { CastPick } from "@/hooks/use-cast-picks";

export { useCastPicks, type CastPick } from "@/hooks/use-cast-picks";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
