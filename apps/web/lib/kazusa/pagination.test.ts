import { describe, expect, it } from "vitest";
import { messagesKeyGetter } from "./pagination";
import type { MessagesResponse } from "@kazusa/client";

const key = messagesKeyGetter(
  { baseUrl: "", userId: "user:sensei", userName: "Sensei" },
  "group:club",
);
const message = {
  id: "a",
  requestId: "a",
  sequence: 101,
  senderId: "alice",
  senderName: "Alice",
  text: "Hello",
  timestamp: 1793016000000,
};

describe("server-owned pagination", () => {
  it("follows the sequence cursor even when a visible page is short and all timestamps match", () => {
    const page: MessagesResponse = {
      messages: [message],
      nextCursor: 101,
      hasMore: true,
    };
    expect(key(1, page)?.at(-1)).toBe(101);
    expect(
      key(2, {
        messages: [{ ...message, id: "b", sequence: 80 }],
        nextCursor: 80,
        hasMore: true,
      })?.at(-1),
    ).toBe(80);
  });
  it("stops when the server says there are no more pages, including a full page", () => {
    expect(
      key(1, {
        messages: Array.from({ length: 50 }, () => message),
        hasMore: false,
      }),
    ).toBeNull();
  });
  it("does not repeat the first page when a cursor is missing", () => {
    expect(key(1, { messages: [message], hasMore: true })).toBeNull();
    expect(
      messagesKeyGetter({ baseUrl: "", userId: "u", userName: "U" }, null)(
        0,
        null,
      ),
    ).toBeNull();
  });
});
