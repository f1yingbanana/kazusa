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

export async function fetchChats(
  baseUrl: string,
  token?: string,
): Promise<ChatsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/chats"),
    undefined,
    token,
  );
  return ChatsResponseSchema.parse(data);
}

export async function fetchMessages(
  baseUrl: string,
  params: { chatId: string; before?: number | null },
  token?: string,
): Promise<MessagesResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/messages", {
      chatId: params.chatId,
      limit: MESSAGE_PAGE_SIZE,
      before: params.before,
    }),
    undefined,
    token,
  );
  return MessagesResponseSchema.parse(data);
}

export async function sendMessage(
  baseUrl: string,
  payload: SendPayload,
  token?: string,
): Promise<SendResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/send"),
    payload,
    token,
  );
  return SendResponseSchema.parse(data);
}

export async function manageChat(
  baseUrl: string,
  payload: ManageChatPayload,
  token?: string,
): Promise<ManageChatResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/chats/manage"),
    payload,
    token,
  );
  return ManageChatResponseSchema.parse(data);
}

export function eventsUrl(baseUrl: string, token?: string) {
  return buildUrl(baseUrl, "/kazusa/events", token ? { token } : undefined);
}

export async function setTyping(
  baseUrl: string,
  payload: TypingPayload,
  token?: string,
) {
  return postJson<{ success: boolean }>(
    buildUrl(baseUrl, "/kazusa/typing"),
    payload,
    token,
  );
}
