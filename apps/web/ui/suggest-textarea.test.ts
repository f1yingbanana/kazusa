// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SuggestTextarea } from "./suggest-textarea";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

describe("SuggestTextarea", () => {
  it("ignores submit shortcuts during IME composition", () => {
    const onSubmit = vi.fn();
    render(
      createElement(SuggestTextarea, {
        "aria-label": "Notes",
        value: "hello",
        onChange: vi.fn(),
        trigger: "[[",
        suggest: () => [],
        insert: (value) => value,
        emptyText: "None",
        onSubmit,
      }),
    );

    const textarea = screen.getByRole("textbox", { name: "Notes" });
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEnter, "isComposing", { value: true });
    textarea.dispatchEvent(composingEnter);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
