import {
  ChatsResponseSchema,
  MessagesResponseSchema,
  SendResponseSchema,
  ManageChatResponseSchema,
  type ChatsResponse,
  type ManageChatPayload,
  type ManageChatResponse,
  type MessagesResponse,
  type SendPayload,
  type SendResponse,
  type TypingPayload,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const MESSAGE_PAGE_SIZE = 50;

export async function fetchChats(): Promise<ChatsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/chats"));
  return ChatsResponseSchema.parse(data);
}

export async function fetchMessages(params: {
  chatId: string;
  before?: number | null;
}): Promise<MessagesResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/messages", {
      chatId: params.chatId,
      limit: MESSAGE_PAGE_SIZE,
      before: params.before,
    }),
  );
  return MessagesResponseSchema.parse(data);
}

export async function sendMessage(payload: SendPayload): Promise<SendResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/send"), payload);
  return SendResponseSchema.parse(data);
}

export async function manageChat(
  payload: ManageChatPayload,
): Promise<ManageChatResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/chats/manage"),
    payload,
  );
  return ManageChatResponseSchema.parse(data);
}

export function eventsUrl() {
  return buildUrl("/kazusa/events");
}

export async function setTyping(payload: TypingPayload) {
  return postJson<{ success: boolean }>(buildUrl("/kazusa/typing"), payload);
}
