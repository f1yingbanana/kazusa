"use client";

import type { CharacterKind } from "@kazusa/client";
import { memo } from "react";
import { Avatar } from "@/ui/avatar";
import { PRESENCE_TEXT, usePresence } from "./presence";

/** A character's face, its ring following their live presence. */
export const CharacterAvatar = memo(function CharacterAvatar({
  id,
  name,
  avatarUrl,
  kind,
  size,
  decorative,
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  kind?: CharacterKind;
  size?: "xs" | "sm" | "md" | "lg";
  /** Inside a control that already names them. */
  decorative?: boolean;
}) {
  const { presence } = usePresence({ id, kind });
  const text = PRESENCE_TEXT[presence];
  return (
    <Avatar
      name={name}
      src={avatarUrl}
      presence={presence}
      size={size}
      label={text ? `${name}, ${text}` : name}
      decorative={decorative}
    />
  );
});
