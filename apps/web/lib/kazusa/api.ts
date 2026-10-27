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
import { z } from "zod";

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

async function request<T>(
  url: string,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
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

function postJson<T>(url: string, body: unknown, token?: string) {
  return request<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function fetchAgents(
  baseUrl: string,
  token?: string,
): Promise<AgentsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/agents"),
    undefined,
    token,
  );
  return AgentsResponseSchema.parse(data);
}

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
  return buildUrl(
    baseUrl,
    "/kazusa/events",
    token ? { token } : undefined,
  );
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
