// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLingering } from "./use-lingering";

afterEach(() => {
  vi.restoreAllMocks();
});

const run = (initial: string[]) =>
  renderHook(({ items }) => useLingering(items, (item) => item, 300), {
    initialProps: { items: initial },
  });

const shape = (list: { item: string; leaving: boolean }[]) =>
  list.map(({ item, leaving }) => (leaving ? `${item}…` : item));

describe("useLingering", () => {
  it("keeps what left, in its place, marked as leaving", () => {
    const view = run(["a", "b", "c"]);
    view.rerender({ items: ["a", "c"] });
    expect(shape(view.result.current)).toEqual(["a", "b…", "c"]);
  });

  it("drops it on the first render after its time is up", () => {
    const view = run(["a", "b"]);
    view.rerender({ items: ["a"] });
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    view.rerender({ items: ["a"] });
    expect(shape(view.result.current)).toEqual(["a"]);
  });

  it("puts a newcomer after what it follows, without moving the rest", () => {
    const view = run(["a", "c"]);
    view.rerender({ items: ["a", "b", "c"] });
    expect(shape(view.result.current)).toEqual(["a", "b", "c"]);
  });

  it("brings back something that returns before it's gone", () => {
    const view = run(["a", "b"]);
    view.rerender({ items: ["a"] });
    view.rerender({ items: ["a", "b"] });
    expect(shape(view.result.current)).toEqual(["a", "b"]);
  });

  it("drops it on its own once its time is up", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const view = run(["a", "b"]);
      view.rerender({ items: ["a"] });
      expect(shape(view.result.current)).toEqual(["a", "b…"]);
      void act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(shape(view.result.current)).toEqual(["a"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
