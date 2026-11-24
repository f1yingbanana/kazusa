"use client";

import { XIcon } from "lucide-react";
import { ChatSummarySection } from "@/components/inspector/sections/chat-summary";

/**
 * A chat keeps its full summary (who, join/leave, rename, add and remove,
 * open-to-join) — those controls are the reason to open it — in the panel's frame.
 */
export function HaloChatSheet({ id, onClose }: { id: string; onClose?: () => void }) {
  return (
    <article className="halo-sheet halo-chat-sheet" aria-label="Chat">
      {onClose ? (
        <button
          type="button"
          className="halo-icon-button halo-chat-close"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      ) : null}
      <ChatSummarySection key={id} entity={{ kind: "chat", id }} />
    </article>
  );
}
