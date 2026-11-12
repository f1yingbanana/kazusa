// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySceneEvent } from "../../../../lib/live/scene-state";
import type { SceneLine } from "../../../../lib/scene/state";
import { Echoes } from "./echoes";

vi.mock("../../../../lib/live/scene-state", () => ({
  applySceneEvent: vi.fn(),
}));

/** A line still being said, its message not landed yet. */
const beingSaid: SceneLine = {
  speakerId: "alice",
  speakerName: "Alice",
  kind: "speech",
  text: "Still going on about it",
  said: { from: 0, until: 60_000 },
  leftAt: 0,
  cutOff: false,
};

const echoes = (line: SceneLine) =>
  createElement(Echoes, {
    chatId: "huddle",
    echoes: [line],
    nameOf: () => "Alice",
  });

/**
 * An animation ending. jsdom has no AnimationEvent, so React listens under the
 * prefixed name: send both.
 */
const endAnimation = (element: Element) =>
  act(() => {
    element.dispatchEvent(new Event("animationend", { bubbles: true }));
    element.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
  });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("echoes", () => {
  it("lets an echo that faded while still being said go once its message lands", () => {
    const view = render(echoes(beingSaid));
    const surface = view.container.querySelector("[data-echo] > *");
    if (!surface) throw new Error("no echo");
    endAnimation(surface);
    expect(applySceneEvent).not.toHaveBeenCalled();
    view.rerender(echoes({ ...beingSaid, messageId: "m1" }));
    expect(vi.mocked(applySceneEvent).mock.calls).toEqual([
      ["huddle", { type: "fade", messageId: "m1" }],
    ]);
  });
});
