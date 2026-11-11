"use client";

import { useCallback } from "react";
import { useQueryState } from "nuqs";
import {
  canDrawScene,
  chatRendering,
  type ChatRendering,
} from "@/lib/scene/rendering";
import type { ChatInfo } from "@/lib/source/chats/types";
import {
  setHuddleRendering,
  useHuddleRendering,
} from "@/lib/state/preferences-store";
import { chatsParsers } from "../search-params";

export interface ChatRenderingState {
  /** How the open chat is drawn now. */
  readonly as: ChatRendering;
  /** Whether it can be drawn as a scene at all: the Scene | Transcript switch. */
  readonly canScene: boolean;
  /** Switches, writing the link and the viewer's preference. */
  readonly setAs: (as: ChatRendering) => void;
}

/**
 * Scene or transcript for the open chat (`chats.as`, else the remembered
 * choice). Needs nothing loaded, so the first paint is already the right one.
 */
export function useChatRendering(
  chat: Pick<ChatInfo, "type" | "draft">,
): ChatRenderingState {
  const [explicit, setExplicit] = useQueryState(
    "chats.as",
    chatsParsers["chats.as"].withOptions({ history: "replace" }),
  );
  const preferred = useHuddleRendering();
  const as = chatRendering({
    type: chat.type,
    draft: chat.draft,
    explicit,
    preferred,
  });
  const setAs = useCallback(
    (next: ChatRendering) => {
      setHuddleRendering(next);
      void setExplicit(next);
    },
    [setExplicit],
  );
  return { as, canScene: canDrawScene(chat), setAs };
}
