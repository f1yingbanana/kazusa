import type { CharacterKind, CharacterStatus } from "@kazusa/client";

export type PresenceState =
  "idle" | "thinking" | "composing" | "offstage" | "unknown";

/** Ring state from structured fields only (D7). Never from task text. */
export function presenceState(
  kind: CharacterKind | undefined,
  status: CharacterStatus | undefined,
): PresenceState {
  if (kind === "npc" || !status || status.brain === "unknown") return "unknown";
  if (!status.onstage) return "offstage";
  if (status.composingIn.length > 0) return "composing";
  if (status.brain === "thinking") return "thinking";
  return "idle";
}
