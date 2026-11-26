"use client";

import { MapPinIcon } from "lucide-react";
import { useCharacter } from "@/hooks/use-characters";
import { usePlace } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { firstName } from "@/lib/format";
import { TextButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { CharacterAvatar } from "../characters/character-avatar";
import { chatIcon, useChatTitle } from "./chat-meta";

type ChipVariant = "pill" | "inline";

const BASE =
  "inline-flex max-w-full min-w-0 items-center align-middle leading-5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-primary sm:max-w-80";

/** Shared person chip: clickable to inspect, with a crisp `xs` avatar that never overlaps text. */
export function CharacterChip({
  id,
  showAvatar = true,
  short = false,
  variant = "inline",
  className,
}: {
  id: string;
  showAvatar?: boolean;
  short?: boolean;
  variant?: ChipVariant;
  className?: string;
}) {
  const character = useCharacter(id);
  const [, select] = useSelection();
  const fullName = character?.name ?? id;
  const label = short ? firstName(fullName) : fullName;

  return (
    <TextButton
      title={short && label !== fullName ? fullName : undefined}
      className={cx(
        BASE,
        variant === "pill"
          ? "gap-1.5 rounded-full bg-ui-tint py-0.5 ps-0.5 pe-2.5 text-[0.8125rem] font-bold text-ui-ink hover:bg-ui-primary/12 hover:text-ui-primary"
          : "gap-1.5 rounded-[0.5rem] px-1 py-px font-bold text-ui-ink hover:bg-ui-tint hover:text-ui-primary",
        className,
      )}
      onClick={() => void select({ kind: "character", id })}
    >
      {showAvatar ? (
        <CharacterAvatar
          id={id}
          name={fullName}
          avatarUrl={character?.avatarUrl}
          kind={character?.kind}
          size="xs"
          decorative
        />
      ) : null}
      <span className="truncate">{label}</span>
    </TextButton>
  );
}

/** Shared place chip (`bare` drops the pin where context already implies a place). */
export function PlaceChip({
  id,
  bare = false,
  quiet = false,
  variant = "inline",
  className,
}: {
  id: string;
  bare?: boolean;
  quiet?: boolean;
  variant?: ChipVariant;
  className?: string;
}) {
  const place = usePlace(id);
  const [, select] = useSelection();
  return (
    <TextButton
      className={cx(
        BASE,
        variant === "pill"
          ? "gap-1 rounded-full bg-ui-tint px-2.5 py-0.5 text-[0.8125rem] font-bold text-ui-ink hover:bg-ui-primary/12 hover:text-ui-primary"
          : "gap-1 rounded-[0.5rem] px-1 py-0.5 hover:bg-ui-tint hover:text-ui-primary",
        quiet ? "font-semibold text-ui-soft" : "font-bold text-ui-ink",
        className,
      )}
      onClick={() => void select({ kind: "place", id })}
    >
      {bare ? null : (
        <MapPinIcon aria-hidden className="size-3.5 shrink-0 opacity-75" />
      )}
      <span className="truncate">{place?.name ?? id}</span>
    </TextButton>
  );
}

/** Shared chat/conversation chip (`label` overrides its resolved title). */
export function ChatChip({
  id,
  label,
  variant = "inline",
  className,
}: {
  id: string;
  label?: string;
  variant?: ChipVariant;
  className?: string;
}) {
  const { title, type } = useChatTitle(id);
  const [, select] = useSelection();
  const Icon = chatIcon(type);
  return (
    <TextButton
      className={cx(
        BASE,
        variant === "pill"
          ? "gap-1 rounded-full bg-ui-tint px-2.5 py-0.5 text-[0.8125rem] font-bold text-ui-ink hover:bg-ui-primary/12 hover:text-ui-primary"
          : "gap-1 rounded-[0.5rem] px-1 py-0.5 font-bold text-ui-ink hover:bg-ui-tint hover:text-ui-primary",
        className,
      )}
      onClick={() => void select({ kind: "chat", id })}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-ui-soft" />
      <span className="truncate">{label ?? title}</span>
    </TextButton>
  );
}
