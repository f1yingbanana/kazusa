import {
  MessagesResponseSchema,
  ObservedChatsResponseSchema,
  type MessagesResponse,
  type ObservedChatsResponse,
} from "@kazusa/client";
import { MESSAGE_PAGE_SIZE } from "../chats/http";
import { buildUrl, request } from "../http";

export const OBSERVED_CHATS_KEY = "kazusa/observe/chats";
export const OBSERVED_MESSAGES_KEY = "kazusa/observe/messages";

export function observedChatsKey() {
  return [OBSERVED_CHATS_KEY] as const;
}

export async function fetchObservedChats(): Promise<ObservedChatsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/observe/chats"));
  return ObservedChatsResponseSchema.parse(data);
}

export async function fetchObservedMessages(params: {
  chatId: string;
  before?: number | null;
}): Promise<MessagesResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/observe/messages", {
      chatId: params.chatId,
      limit: MESSAGE_PAGE_SIZE,
      before: params.before,
    }),
  );
  return MessagesResponseSchema.parse(data);
}
