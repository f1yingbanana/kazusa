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

export function observedChatsKey(config: {
  readonly baseUrl: string;
  readonly token?: string;
}) {
  return [OBSERVED_CHATS_KEY, config.baseUrl, config.token ?? ""] as const;
}

export async function fetchObservedChats(
  baseUrl: string,
  token?: string,
): Promise<ObservedChatsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/observe/chats"),
    undefined,
    token,
  );
  return ObservedChatsResponseSchema.parse(data);
}

export async function fetchObservedMessages(
  baseUrl: string,
  params: { chatId: string; before?: number | null },
  token?: string,
): Promise<MessagesResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/observe/messages", {
      chatId: params.chatId,
      limit: MESSAGE_PAGE_SIZE,
      before: params.before,
    }),
    undefined,
    token,
  );
  return MessagesResponseSchema.parse(data);
}
