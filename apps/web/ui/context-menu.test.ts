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
import { ContextMenu } from "./context-menu";

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
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
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

describe("ContextMenu", () => {
  it("opens a compact menu on right-click and runs the chosen action", async () => {
    const copy = vi.fn();
    const remove = vi.fn();
    const rowClick = vi.fn();

    render(
      createElement(
        ContextMenu,
        {
          resolve: (target) => {
            const row = (target as HTMLElement | null)?.closest("[data-row]");
            if (!row) return undefined;
            return {
              title: "Gehenna",
              actions: [
                { key: "copy", group: 0, label: "Copy", run: copy },
                {
                  key: "delete",
                  group: 1,
                  label: "Delete",
                  danger: true,
                  run: remove,
                },
              ],
            };
          },
        },
        createElement(
          "div",
          null,
          createElement(
            "button",
            { type: "button", "data-row": "gehenna", onClick: rowClick },
            "Gehenna",
          ),
          createElement("span", null, "Empty"),
        ),
      ),
    );

    fireEvent.contextMenu(screen.getByText("Empty"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Gehenna" }));
    const menu = await screen.findByRole("menu", { name: "Gehenna" });
    expect(menu.dataset.compact).toBe("true");
    const copyItem = screen.getByRole("menuitem", { name: "Copy" });
    expect(copyItem).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();

    fireEvent.click(copyItem);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a bottom sheet on touch hold, swallows the release click, and cancels on drag", async () => {
    vi.useFakeTimers();
    coarse = true;
    const copy = vi.fn();
    const rowClick = vi.fn();

    render(
      createElement(
        ContextMenu,
        {
          title: "Prefect HQ",
          actions: [{ key: "copy", label: "Copy as Markdown", run: copy }],
        },
        createElement(
          "button",
          { type: "button", onClick: rowClick },
          "Prefect HQ",
        ),
      ),
    );

    const row = screen.getByRole("button", { name: "Prefect HQ" });

    // Moving past slop cancels the hold before the sheet opens.
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(row, {
      pointerType: "touch",
      clientX: 10,
      clientY: 30,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Holding still opens the bottom sheet and swallows the follow-up tap click.
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const dialog = screen.getByRole("dialog", { name: "Prefect HQ" });
    expect(dialog).toBeTruthy();

    fireEvent.pointerUp(row, { pointerType: "touch" });
    fireEvent.click(row);
    expect(rowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
