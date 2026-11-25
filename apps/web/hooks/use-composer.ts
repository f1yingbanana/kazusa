"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { parseReply } from "@/lib/source/chats/reply";
import type { MessageType } from "@/lib/source/chats/types";
import { setMessageDraft, useMessageDraft } from "@/lib/state/chat-draft";

/** Typing is signalled at most this often, and ends after this long idle. */
const TYPING_EVERY_MS = 3_000;
const TYPING_IDLE_MS = 4_000;
/** Face to face, the placeholder teaches how to do something. */
const ACT_PLACEHOLDER = "Say something, or *do something*";

export interface ComposerProps {
  /** Whose draft this is: the same in a huddle's scene and its transcript. */
  chatId: string;
  /** Where nothing can be done, only written (a text chat). */
  placeholder?: string;
  onSend: (text: string, type: MessageType) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
  /**
   * Face to face: a message wrapped in asterisks is something done
   * (`parseReply`).
   */
  canAct?: boolean;
}

/**
 * What both reply boxes do, whichever draws it: the chat's draft (from the
 * draft store, so the scene's box and the transcript's share it), what it will
 * be sent as (`parseReply`: wrapped in asterisks, face to face, an action),
 * typing signals while there is text (at most every 3s, ending after 4s idle,
 * on blur, on send and on unmount), and Enter to send, Shift+Enter for a new
 * line, never mid-composition (an IME).
 */
export function useComposer({
  chatId,
  placeholder = "Message",
  onSend,
  onTyping,
  disabled = false,
  canAct = false,
}: ComposerProps) {
  const text = useMessageDraft(chatId);
  const reply = parseReply(text, canAct);
  const lastTyping = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(idleTimer.current);
      onTyping(false);
    },
    [onTyping],
  );
  function stopTyping() {
    clearTimeout(idleTimer.current);
    lastTyping.current = 0;
    onTyping(false);
  }
  function change(value: string) {
    setMessageDraft(chatId, value);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (Date.now() - lastTyping.current >= TYPING_EVERY_MS) {
      lastTyping.current = Date.now();
      onTyping(true);
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }
  const canSend = reply.text.length > 0 && !disabled;
  function submit() {
    if (!canSend) return;
    stopTyping();
    onSend(reply.text, reply.type);
    setMessageDraft(chatId, "");
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
  return {
    text,
    /** The draft as it stands would be sent as something done. */
    acting: reply.type === "action",
    placeholder: canAct ? ACT_PLACEHOLDER : placeholder,
    disabled,
    canSend,
    change,
    stopTyping,
    submit,
    keyDown,
  };
}
