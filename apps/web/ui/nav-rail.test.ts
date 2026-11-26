// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NavRail, NavRailItem } from "./nav-rail";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

let coarse = false;

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
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
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  coarse = false;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderRail(vertical: boolean) {
  return render(
    createElement(NavRail, {
      label: "Sections",
      vertical,
      current: "world",
      children: [
        createElement(NavRailItem, {
          key: "world",
          value: "world",
          label: "World",
          href: "/world",
          icon: createElement("span", { "aria-hidden": true }, "W"),
          onClick: () => {},
        }),
        createElement(NavRailItem, {
          key: "chats",
          value: "chats",
          label: "Chats",
          href: "/chats",
          icon: createElement("span", { "aria-hidden": true }, "C"),
          onClick: () => {},
        }),
      ],
    }),
  );
}

describe("NavRail tooltips", () => {
  it("opens tooltips to the right when vertical", () => {
    vi.useFakeTimers();
    renderRail(true);
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "Chats" }), {
      pointerType: "mouse",
    });
    void act(() => {
      vi.advanceTimersByTime(500);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.getAttribute("data-side")).toBe("right");
  });

  it("opens tooltips above the horizontal bar on fine pointers", () => {
    vi.useFakeTimers();
    renderRail(false);
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "Chats" }), {
      pointerType: "mouse",
    });
    void act(() => {
      vi.advanceTimersByTime(500);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.getAttribute("data-side")).toBe("top");
  });

  it("suppresses bar tooltips on coarse touch pointers", () => {
    coarse = true;
    vi.useFakeTimers();
    renderRail(false);
    const chats = screen.getByRole("tab", { name: "Chats" });
    fireEvent.pointerEnter(chats, { pointerType: "touch" });
    fireEvent.focus(chats);
    void act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
