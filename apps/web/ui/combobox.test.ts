// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OnePicker } from "./combobox";

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

describe("OnePicker", () => {
  it("syncs the displayed label when value or options update externally", () => {
    const options = [
      { value: "courtyard", label: "Courtyard" },
      { value: "gehenna", label: "Gehenna" },
    ];
    const { rerender } = render(
      createElement(OnePicker, {
        label: "Home",
        placeholder: "No home",
        options: [],
        value: "courtyard",
        onChange: vi.fn(),
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Home",
    });
    expect(input.value).toBe("courtyard");

    rerender(
      createElement(OnePicker, {
        label: "Home",
        placeholder: "No home",
        options,
        value: "courtyard",
        onChange: vi.fn(),
      }),
    );
    expect(input.value).toBe("Courtyard");

    rerender(
      createElement(OnePicker, {
        label: "Home",
        placeholder: "No home",
        options,
        value: "gehenna",
        onChange: vi.fn(),
      }),
    );
    expect(input.value).toBe("Gehenna");

    rerender(
      createElement(OnePicker, {
        label: "Home",
        placeholder: "No home",
        options,
        value: undefined,
        onChange: vi.fn(),
      }),
    );
    expect(input.value).toBe("");
  });
});
