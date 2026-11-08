import { parseAsString } from "nuqs/server";

export const chatsParsers = {
  "chats.id": parseAsString,
  "chats.member": parseAsString,
  "chats.dm": parseAsString,
  "chats.talk": parseAsString,
  "chats.msg": parseAsString,
};
