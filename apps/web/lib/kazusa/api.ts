import { z } from "zod";
import {
  AgentsResponseSchema,
  ChatsResponseSchema,
  MessagesResponseSchema,
  SendResponseSchema,
  ManageChatResponseSchema,
  type AgentsResponse,
  type ChatsResponse,
  type ManageChatPayload,
  type ManageChatResponse,
  type MessagesResponse,
  type SendPayload,
  type SendResponse,
  type TypingPayload,
} from "@kazusa/client";

export const MESSAGE_PAGE_SIZE = 50;

export class KazusaApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "KazusaApiError";
    this.status = status;
  }
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined | null>,
) {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, "")}${path}`,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new KazusaApiError(
      `Could not reach the Kazusa server at ${new URL(url).origin}.`,
    );
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = z
        .object({
          error: z.string().optional(),
          message: z.string().optional(),
        })
        .parse(await response.json());
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      // Non-JSON error bodies fall back to the status text.
    }
    throw new KazusaApiError(
      `Request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

function postJson<T>(url: string, body: unknown) {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchAgents(baseUrl: string): Promise<AgentsResponse> {
  const data = await request<unknown>(buildUrl(baseUrl, "/kazusa/agents"));
  return AgentsResponseSchema.parse(data);
}

export async function fetchChats(baseUrl: string): Promise<ChatsResponse> {
  const data = await request<unknown>(buildUrl(baseUrl, "/kazusa/chats"));
  return ChatsResponseSchema.parse(data);
}

export async function fetchMessages(
  baseUrl: string,
  params: { chatId: string; before?: number | null },
): Promise<MessagesResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/messages", {
      chatId: params.chatId,
      limit: MESSAGE_PAGE_SIZE,
      before: params.before,
    }),
  );
  return MessagesResponseSchema.parse(data);
}

export async function sendMessage(
  baseUrl: string,
  payload: SendPayload,
): Promise<SendResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/send"),
    payload,
  );
  return SendResponseSchema.parse(data);
}

export async function manageChat(
  baseUrl: string,
  payload: ManageChatPayload,
): Promise<ManageChatResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/chats/manage"),
    payload,
  );
  return ManageChatResponseSchema.parse(data);
}

export function eventsUrl(baseUrl: string) {
  return buildUrl(baseUrl, "/kazusa/events");
}

export function setTyping(baseUrl: string, payload: TypingPayload) {
  return postJson<{ success: boolean }>(
    buildUrl(baseUrl, "/kazusa/typing"),
    payload,
  );
}
