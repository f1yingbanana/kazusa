import type { ChatType } from "@kazusa/client";

/** How a chat is drawn: a huddle as people in a place, or any chat as a list. */
export type ChatRendering = "scene" | "list";

export interface RenderingInput {
  readonly type: ChatType;
  /** Not sent yet: no id the scene could follow. */
  readonly draft?: boolean;
  /** `chats.as` from the link, when it names one. */
  readonly explicit: ChatRendering | null;
  /** The viewer's remembered choice for huddles. */
  readonly preferred: ChatRendering;
}

/** Only a sent huddle can be drawn as a scene. */
export function canDrawScene(
  chat: Pick<RenderingInput, "type" | "draft">,
): boolean {
  return chat.type === "huddle" && chat.draft !== true;
}

/**
 * Which way a chat is drawn. A text chat or a draft huddle is always the list.
 * A huddle follows the link when it says, else the viewer's preference (a scene
 * unless they chose the transcript), with or without art: without a backdrop
 * the scene is a plain surface, and nobody without portraits is drawn.
 */
export function chatRendering(input: RenderingInput): ChatRendering {
  if (!canDrawScene(input)) return "list";
  return input.explicit ?? input.preferred;
}
