import { describe, expect, it } from "vitest";
import type { JournalEvent } from "@kazusa/client";
import { matchesTimelineQuery } from "./query";

const event: JournalEvent = {
  seq: 1,
  simTime: 0,
  kind: "task.started",
  actors: ["ann"],
  chatId: "chat-1",
  payload: {
    taskId: "task-1",
    type: "work",
    description: "Filing",
    duration: 30,
    endAt: 30,
  },
};

describe("timeline tail filters", () => {
  it("matches an empty query", () => {
    expect(matchesTimelineQuery(event, {})).toBe(true);
  });
  it("filters by kind, actor and chat", () => {
    expect(matchesTimelineQuery(event, { kinds: ["task.started"] })).toBe(true);
    expect(matchesTimelineQuery(event, { kinds: ["clock.changed"] })).toBe(
      false,
    );
    expect(matchesTimelineQuery(event, { actors: ["bo"] })).toBe(false);
    expect(matchesTimelineQuery(event, { chats: ["chat-2"] })).toBe(false);
  });
  it("excludes events without a chat from a chat filter", () => {
    const { chatId: _chatId, ...noChat } = event;
    expect(matchesTimelineQuery(noChat, { chats: ["chat-1"] })).toBe(false);
  });
});
