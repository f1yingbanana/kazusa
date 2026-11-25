import type { CharacterKind, CharacterStatus } from "@kazusa/client";
import { useCharacterStatus } from "@/hooks/use-characters";
import { presenceState } from "@/lib/state/presence";
import type { Presence } from "@/ui/avatar";

/** What each presence state reads as in text, beside a face or under a name. */
export const PRESENCE_TEXT: Record<Presence, string> = {
  idle: "Awake",
  thinking: "Thinking",
  composing: "Typing",
  offstage: "Offstage",
  unknown: "",
};

/** Someone's live status, and the presence it shows as. NPCs have neither. */
export function usePresence(character: {
  readonly id: string;
  readonly kind?: CharacterKind | undefined;
}): { status: CharacterStatus | undefined; presence: Presence } {
  const status = useCharacterStatus(
    character.kind === "agent" ? character.id : undefined,
  );
  return { status, presence: presenceState(character.kind, status) };
}
