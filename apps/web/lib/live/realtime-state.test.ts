// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TypingStreamEvent } from "@kazusa/client";
import {
  applyTyping,
  clearTypist,
  expireTyping,
  receiveMessage,
  retainMembers,
  setActiveChat,
  useRealtimeStore,
  useTyping,
} from "./realtime-state";

const typing = (
  chatId: string,
  senderId = "alice",
  expiresAt = 100,
): TypingStreamEvent => ({
  type: "typing",
  chatId,
  senderId,
  senderName: senderId,
  isTyping: true,
  mode: "typing",
  expiresAt,
});
beforeEach(() =>
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true),
);
afterEach(cleanup);

describe("realtime state", () => {
  it("isolates each chat's typing and unread selectors from unrelated updates", () => {
    const render = vi.fn();
    const { result } = renderHook(() => {
      render();
      return {
        typing: useTyping("one"),
        unread: useRealtimeStore((state) => state.unreadByChat.one ?? 0),
      };
    });
    const empty = result.current.typing;
    act(() => {
      applyTyping(typing("two"));
      receiveMessage("two", true);
    });
    expect(result.current.typing).toBe(empty);
    expect(render).toHaveBeenCalledOnce();
    act(() => applyTyping(typing("one")));
    expect(result.current.typing.map((t) => t.senderId)).toEqual(["alice"]);
    act(() => receiveMessage("one", true));
    expect(result.current.unread).toBe(1);
    act(() => setActiveChat("one"));
    expect(result.current.unread).toBe(0);
    act(() => {
      receiveMessage("one", true);
      receiveMessage("one", false);
    });
    expect(result.current.unread).toBe(0);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("expires typing without changing other chats' references, and respects membership", () => {
    applyTyping(typing("one"));
    applyTyping(typing("two", "bob", 200));
    const bob = useRealtimeStore.getState().typingByChat.two;
    expireTyping(100);
    expect(useRealtimeStore.getState().typingByChat.one).toBeUndefined();
    expect(useRealtimeStore.getState().typingByChat.two).toBe(bob);
    applyTyping(typing("observed"));
    retainMembers([{ id: "two", members: [] }]);
    expect(useRealtimeStore.getState().typingByChat.two).toBeUndefined();
    expect(useRealtimeStore.getState().typingByChat.observed).toHaveLength(1);
    clearTypist("observed", "alice");
    expect(useRealtimeStore.getState().typingByChat.observed).toBeUndefined();
  });
});
