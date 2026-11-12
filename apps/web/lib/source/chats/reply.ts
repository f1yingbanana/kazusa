import type { MessageType } from "./types";

/** What a reply box sends: the text and whether it is said or done. */
export interface Reply {
  readonly text: string;
  readonly type: MessageType;
}

/** One or two asterisks around the whole message, the same on both sides. */
const WRAPPED = /^(\*{1,2})(?!\*)([\s\S]*?[^*\s][\s\S]*?)(?<!\*)\1$/;

/**
 * What the player typed, as it will be sent. Where actions are allowed (face to
 * face, `canAct`), a message wholly wrapped in one or two asterisks, the same
 * on both sides (`*waves*`, `**waves**`), is an action: sent without them and
 * without the spaces just inside them. Anything else is speech, sent as typed
 * (trimmed): asterisks inside a longer message, unbalanced ones, more than two,
 * or nothing between them. Elsewhere nothing is read into it.
 */
export function parseReply(typed: string, canAct: boolean): Reply {
  const text = typed.trim();
  if (!canAct) return { text, type: "speech" };
  const wrapped = WRAPPED.exec(text);
  const inner = wrapped?.[2]?.trim();
  // Asterisks inside mean more than one thing was marked: say it as typed.
  return inner && !inner.includes("*")
    ? { text: inner, type: "action" }
    : { text, type: "speech" };
}
