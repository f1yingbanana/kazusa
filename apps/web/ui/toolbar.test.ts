// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Toolbar, ToolbarIconButton } from "./toolbar";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe("ToolbarIconButton", () => {
  it("exposes its label directly on the button without waiting for the tooltip", () => {
    const onZoom = vi.fn();
    render(
      createElement(Toolbar, {
        label: "Map controls",
        children: createElement(ToolbarIconButton, {
          label: "Zoom in",
          shortcut: "+",
          onClick: onZoom,
          children: createElement("span", { "aria-hidden": true }, "+"),
        }),
      }),
    );
    const button = screen.getByRole("button", { name: "Zoom in" });
    expect(button.getAttribute("aria-label")).toBe("Zoom in");
    fireEvent.click(button);
    expect(onZoom).toHaveBeenCalledTimes(1);
  });
});
