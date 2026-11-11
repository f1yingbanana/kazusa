// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@kazusa/client";
import {
  applySceneEvent,
  closeScene,
  openScene,
  silenceScenes,
  syncSceneDrawable,
  syncSceneMembers,
  useSceneBehind,
  useSceneFigures,
  useSceneEchoes,
  useSceneLine,
  useSceneNextShowAt,
  useSceneOpen,
  useSceneStore,
} from "./scene-state";

const PLAYER = "user:you";
const message = (id: string, senderId: string, text: string): ChatMessage => ({
  id,
  requestId: id,
  sequence: Number(id.slice(1)),
  senderId,
  senderName: senderId,
  text,
  timestamp: 0,
});
const open = (
  chatId: string,
  members: string[] = [PLAYER, "a", "b"],
  /** `null`: the roster isn't read yet. */
  drawable: ReadonlySet<string> | null = new Set(["a", "b"]),
) =>
  openScene({
    chatId,
    playerId: PLAYER,
    members,
    slots: 5,
    drawable: drawable ?? undefined,
  });

beforeEach(() => useSceneStore.setState(useSceneStore.getInitialState(), true));
afterEach(cleanup);

describe("scene store", () => {
  it("keeps a scene only between open and close, and drops events for other chats", () => {
    const before = useSceneStore.getState();
    applySceneEvent("nowhere", {
      type: "typing",
      typing: { senderId: "a", isTyping: true, mode: "speaking" },
      at: 0,
    });
    syncSceneMembers([{ id: "nowhere", members: ["a"] }]);
    silenceScenes();
    expect(useSceneStore.getState()).toBe(before);
    open("one");
    const scene = useSceneStore.getState().scenes.one;
    // Opening again keeps what is there.
    open("one", [PLAYER]);
    expect(useSceneStore.getState().scenes.one).toBe(scene);
    expect(scene?.figures.map((f) => f.id)).toEqual(["a", "b"]);
    closeScene("one");
    closeScene("one");
    expect(useSceneStore.getState().scenes).toEqual({});
  });

  it("applies members from chat lists, an ended chat as empty", () => {
    open("one");
    open("two");
    const two = useSceneStore.getState().scenes.two;
    syncSceneMembers([
      { id: "one", members: [PLAYER, "a", "b"], ended: true, placeId: "park" },
      { id: "elsewhere", members: [] },
    ]);
    const one = useSceneStore.getState().scenes.one;
    expect(one?.placeId).toBe("park");
    expect(one?.figures.map((f) => f.presence)).toEqual(["leaving", "leaving"]);
    expect(useSceneStore.getState().scenes.two).toBe(two);
    const state = useSceneStore.getState();
    syncSceneMembers([{ id: "two", members: [PLAYER, "a", "b"] }]);
    expect(useSceneStore.getState()).toBe(state);
  });

  it("tells every open scene who can be drawn, leaving scenes that already know as they are", () => {
    open("one", [PLAYER, "a", "b"], null);
    open("two");
    const two = useSceneStore.getState().scenes.two;
    expect(useSceneStore.getState().scenes.one?.figures).toEqual([]);
    syncSceneDrawable(new Set(["a", "b"]));
    const { scenes } = useSceneStore.getState();
    expect(scenes.one?.figures.map((f) => [f.id, f.presence])).toEqual([
      ["a", "entering"],
      ["b", "entering"],
    ]);
    expect(scenes.two).toBe(two);
  });

  it("silences every scene at once, leaving quiet ones as they are", () => {
    open("one");
    open("two");
    applySceneEvent("one", {
      type: "typing",
      typing: { senderId: "a", isTyping: true, mode: "speaking" },
      at: 0,
    });
    const two = useSceneStore.getState().scenes.two;
    silenceScenes();
    const { scenes } = useSceneStore.getState();
    expect(scenes.one?.speakers).toEqual([]);
    expect(scenes.two).toBe(two);
  });

  it("re-renders only the chat that changed, and figures and lines apart", () => {
    open("one");
    open("two");
    const renders = { oneFigures: 0, oneLines: 0, two: 0, behind: 0 };
    renderHook(() => {
      renders.oneFigures++;
      return useSceneFigures("one");
    });
    renderHook(() => {
      renders.oneLines++;
      return [useSceneLine("one"), useSceneEchoes("one")];
    });
    renderHook(() => {
      renders.two++;
      return [
        useSceneFigures("two"),
        useSceneLine("two"),
        useSceneEchoes("two"),
        useSceneOpen("two"),
      ];
    });
    renderHook(() => {
      renders.behind++;
      return [useSceneBehind("one"), useSceneNextShowAt("one")];
    });
    const initial = { ...renders };
    // A line from the player: lines change, figures don't.
    act(() =>
      applySceneEvent("one", {
        type: "message",
        message: message("m1", PLAYER, "hello"),
        at: 0,
      }),
    );
    expect(renders.oneLines).toBe(initial.oneLines + 1);
    expect(renders.oneFigures).toBe(initial.oneFigures);
    // Someone starts speaking: neither figures nor lines change (who is lit
    // follows the panel's line).
    act(() =>
      applySceneEvent("one", {
        type: "typing",
        typing: { senderId: "a", isTyping: true, mode: "speaking" },
        at: 0,
      }),
    );
    expect(renders.oneFigures).toBe(initial.oneFigures);
    expect(renders.oneLines).toBe(initial.oneLines + 1);
    expect(renders.two).toBe(initial.two);
    // Nothing waits to be shown for someone speaking.
    expect(renders.behind).toBe(initial.behind);
  });

  it("selects how many lines wait and when the next may show", () => {
    open("one");
    const { result } = renderHook(() => ({
      behind: useSceneBehind("one"),
      next: useSceneNextShowAt("one"),
    }));
    act(() => {
      for (const [index, sender] of ["a", "b", "a", "b"].entries())
        applySceneEvent("one", {
          type: "message",
          message: message(`m${index + 1}`, sender, `line ${index}`),
          at: 1_000,
        });
    });
    // The first shows; the rest wait for it in turn.
    expect(result.current.behind).toBe(3);
    expect(result.current.next).toBeGreaterThan(1_000);
    act(() => applySceneEvent("one", { type: "jump", at: 2_000 }));
    expect(result.current).toEqual({ behind: 0, next: undefined });
  });
});
