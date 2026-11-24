"use client";

import type { CharacterKind } from "@kazusa/client";
import { presenceState } from "@/components/entities/presence-avatar";
import { useCharacterStatus } from "@/hooks/use-characters";

const LABELS = {
  idle: "Idle",
  thinking: "Thinking",
  composing: "Composing",
  offstage: "Offstage",
  unknown: "",
} as const;

/** The halo above a face carries the same presence states as the app's rings. */
export function HaloFace({
  id,
  name,
  avatarUrl,
  kind,
  size = "md",
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  kind?: CharacterKind;
  size?: "sm" | "md" | "lg";
}) {
  const status = useCharacterStatus(kind === "agent" ? id : undefined);
  const state = presenceState(kind, status);
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="halo-face" data-size={size} data-state={state}>
      <span className="halo-ring" aria-hidden="true" />
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="halo-face-img" />
      ) : (
        <span className="halo-face-initials" aria-hidden="true">
          {initials}
        </span>
      )}
      <span className="sr-only">
        {name}
        {LABELS[state] ? `, ${LABELS[state]}` : ""}
      </span>
    </span>
  );
}
