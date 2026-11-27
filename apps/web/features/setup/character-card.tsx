"use client";

import { EyeIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { WorldCharacter } from "@/lib/setup/setup";
import { Avatar } from "@/ui/avatar";
import { cx } from "@/ui/cx";

export function WatchMark({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        large
          ? "grid size-13 shrink-0 place-items-center rounded-full border-2 border-dashed border-ui-line text-ui-soft [&_svg]:size-5 sm:size-17 sm:[&_svg]:size-6"
          : "grid size-7 shrink-0 place-items-center rounded-full border-2 border-dashed border-ui-line text-ui-soft [&_svg]:size-3.5"
      }
    >
      <EyeIcon />
    </span>
  );
}

/**
 * Character detail card shared between setup's Cast and Play as pickers,
 * echoing `PlayAsDialog`'s card geometry and material well.
 */
export function SetupCharacterCard({
  character,
  groupNames = {},
  action,
  className,
}: {
  character?: WorldCharacter;
  groupNames?: Readonly<Record<string, string>>;
  action?: ReactNode;
  className?: string;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const affiliation = (character?.groups ?? [])
    .map((id) => groupNames[id] ?? id)
    .join(" · ");
  const summary = character
    ? character.summary?.trim() || "Ready to join the world."
    : "See everything, everywhere, and talk only to the world's console.";

  return (
    <section
      key={character?.id ?? "observer"}
      aria-live="polite"
      aria-label={character ? character.name : "Observer"}
      className={cx(
        "flex min-h-0 flex-col gap-2.5 rounded-[1.25rem] bg-ui-ground p-3.5 inset-ring inset-ring-ui-line/70 motion-safe:animate-ui-enter sm:gap-3 sm:p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {character ? (
          character.avatarUrl && failedAvatar !== character.avatarUrl ? (
            <img
              src={character.avatarUrl}
              alt=""
              onError={() => setFailedAvatar(character.avatarUrl ?? null)}
              className="size-13 shrink-0 rounded-2xl bg-ui-tint object-cover sm:size-17"
            />
          ) : (
            <Avatar name={character.name} size="lg" decorative />
          )
        ) : (
          <WatchMark large />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-[1.0625rem] leading-tight font-extrabold text-ui-ink">
            {character ? character.name : "Observer"}
          </p>
          {affiliation ? (
            <p className="text-[0.8125rem] leading-snug text-pretty text-ui-soft max-sm:line-clamp-2">
              {affiliation}
            </p>
          ) : null}
        </div>
      </div>

      <p className="text-[0.9375rem] leading-relaxed text-pretty text-ui-ink max-sm:line-clamp-3">
        {summary}
      </p>

      {action ? (
        <div className="mt-auto hidden flex-col gap-2 pt-2 sm:flex">
          {action}
        </div>
      ) : null}
    </section>
  );
}
