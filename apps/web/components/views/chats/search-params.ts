import { parseAsString, parseAsStringLiteral } from "nuqs/server";

/** How a huddle is drawn: as people in a place, or as the transcript. */
const CHAT_RENDERINGS = ["scene", "list"] as const;

// `chats.as` has no default here: it depends on the huddle's art and the
// viewer's preference (`chatRendering` in `lib/scene/rendering.ts`).
export const chatsParsers = {
  "chats.id": parseAsString,
  "chats.member": parseAsString,
  "chats.dm": parseAsString,
  "chats.talk": parseAsString,
  "chats.msg": parseAsString,
  "chats.as": parseAsStringLiteral(CHAT_RENDERINGS),
};
