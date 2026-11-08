// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, MessagesResponse } from "@kazusa/client";
import { usePagedMessages } from "./use-chats";
import { messagesKeyGetter } from "../lib/source/chats/pagination";
import {
  appendCachedMessage,
  markCachedMessagesRead,
} from "../lib/source/chats/cache";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    {
      value: {
        provider: () => new Map(),
        dedupingInterval: 0,
        errorRetryCount: 0,
      },
    },
    children,
  );
}

function message(sequence: number): ChatMessage {
  return {
    id: String(sequence),
    requestId: String(sequence),
    sequence,
    senderId: "alice",
    senderName: "Alice",
    text: String(sequence),
    timestamp: sequence,
    receipts: [{ id: "bob" }],
  };
}

afterEach(cleanup);

describe("message history cache", () => {
  it("keeps streamed messages and read receipts while reopening cached older pages", async () => {
    const newest = message(20);
    const older = message(10);
    const first: MessagesResponse = {
      messages: [newest],
      hasMore: true,
      nextCursor: 20,
    };
    const second: MessagesResponse = { messages: [older], hasMore: false };
    const fetcher = vi.fn(async (_id: string, before: number | null) =>
      before === null ? first : second,
    );
    const { result } = renderHook(
      () => ({
        history: usePagedMessages(messagesKeyGetter("chat"), fetcher),
        mutate: useSWRConfig().mutate,
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.history.messages).toHaveLength(1),
    );
    await act(async () => {
      await result.current.history.loadOlder();
    });
    expect(result.current.history.messages).toHaveLength(2);
    await act(async () => {
      await appendCachedMessage(result.current.mutate, "chat", message(30));
      await markCachedMessagesRead(result.current.mutate, {
        type: "read",
        chatId: "chat",
        readerId: "bob",
        readAt: 50,
        messageIds: ["10", "20"],
      });
    });
    expect(
      result.current.history.messages.map((item) => item.sequence),
    ).toEqual([10, 20, 30]);
    // Leave the revalidation pending: cached pagination must preserve live data
    // before another server response can repair it.
    fetcher.mockImplementation(() => new Promise<MessagesResponse>(() => {}));
    act(() => {
      void result.current.history.loadOlder();
    });
    expect(
      result.current.history.messages.map((item) => item.sequence),
    ).toEqual([10, 20, 30]);
    expect(result.current.history.messages[0].receipts?.[0].readAt).toBe(50);
    expect(result.current.history.messages[1].receipts?.[0].readAt).toBe(50);
  });

  it("loads durable history when a stream event arrives during the first request", async () => {
    let finishInitial: ((page: MessagesResponse) => void) | undefined;
    const initial = new Promise<MessagesResponse>((resolve) => {
      finishInitial = resolve;
    });
    const received = message(30);
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(initial)
      .mockResolvedValue({ messages: [received], hasMore: false });
    const { result } = renderHook(
      () => ({
        history: usePagedMessages(messagesKeyGetter("chat"), fetcher),
        mutate: useSWRConfig().mutate,
      }),
      { wrapper },
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await act(async () => {
      await appendCachedMessage(result.current.mutate, "chat", received);
      finishInitial?.({ messages: [], hasMore: false });
    });
    await waitFor(() =>
      expect(
        result.current.history.messages.map((item) => item.sequence),
      ).toEqual([30]),
    );
    expect(result.current.history.isLoading).toBe(false);
  });
});
