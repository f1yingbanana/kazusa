// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Canvas, CanvasItem } from "./canvas";
import { createCanvasCamera, gridAt } from "./canvas-primitive";

beforeAll(() => {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  document.elementsFromPoint = () => [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Every camera move lands at once, as for someone who prefers less motion.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      onchange: null,
    }),
  });
});

afterEach(cleanup);

const SPOTS = {
  home: { x: 0, y: 0 },
  east: { x: 100, y: 0 },
  south: { x: 0, y: 100 },
} as const;

function renderCanvas(options: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(
    createElement(
      Canvas,
      {
        label: "Map",
        positionOf: (key: string) => SPOTS[key as keyof typeof SPOTS],
        ...options,
      },
      Object.entries(SPOTS).map(([key, at]) =>
        createElement(CanvasItem, {
          key,
          value: key,
          x: at.x,
          y: at.y,
          "aria-label": key,
        }),
      ),
    ),
  );
}

describe("Canvas", () => {
  it("gives its items one tab stop and moves to the nearest one an arrow points at", () => {
    const view = renderCanvas();
    const home = view.getByRole("button", { name: "home" });
    expect(
      view.getAllByRole("button").filter((b) => b.tabIndex === 0),
    ).toHaveLength(1);
    act(() => home.focus());
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "east" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "south" }),
    );
  });

  it("zooms with + and -, and shows everything with 0", () => {
    const onViewportChange = vi.fn();
    const onHome = vi.fn();
    const view = renderCanvas({ onViewportChange, onHome });
    const map = view.getByLabelText("Map");
    act(() => map.focus());
    fireEvent.keyDown(map, { key: "+" });
    expect(onViewportChange.mock.lastCall?.[0].zoom).toBeCloseTo(1.5);
    fireEvent.keyDown(map, { key: "-" });
    expect(onViewportChange.mock.lastCall?.[0].zoom).toBeCloseTo(1);
    fireEvent.keyDown(map, { key: "0" });
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("pans on a scroll by default, and zooms at the pointer when asked to", () => {
    const panned = vi.fn();
    const view = renderCanvas({ onViewportChange: panned });
    fireEvent.wheel(view.getByLabelText("Map"), { deltaY: 120 });
    expect(panned.mock.lastCall?.[0].zoom).toBe(1);
    cleanup();

    const zoomed = vi.fn();
    const next = renderCanvas({ onViewportChange: zoomed, zoomOnScroll: true });
    fireEvent.wheel(next.getByLabelText("Map"), { deltaY: -120 });
    expect(zoomed.mock.lastCall?.[0].zoom).toBeGreaterThan(1);
  });

  it("reports the item under the pointer and marks it", () => {
    const onHoveredChange = vi.fn();
    const view = renderCanvas({ onHoveredChange });
    const east = view.getByRole("button", { name: "east" });
    fireEvent.pointerEnter(east);
    expect(onHoveredChange).toHaveBeenLastCalledWith("east");
    expect(east.hasAttribute("data-hovered")).toBe(true);
    fireEvent.pointerLeave(east);
    expect(onHoveredChange).toHaveBeenLastCalledWith(null);
  });

  it("hands its camera to the page", () => {
    const camera = createCanvasCamera();
    renderCanvas({ camera });
    expect(camera.current).not.toBeNull();
    cleanup();
    expect(camera.current).toBeNull();
  });
});

describe("gridAt", () => {
  // Where the marks fall within a stretch of screen; fine ones once whole.
  const marks = (x: number, zoom: number) => {
    const grid = gridAt(x, 0, zoom);
    const out = new Set<number>();
    const lay = (tile: { x: number; size: number }) => {
      for (let n = 0; n < 200; n += 1) {
        const at = tile.x + tile.size / 2 + n * tile.size;
        if (at >= 100 && at <= 900) out.add(Math.round(at));
      }
    };
    lay(grid.main);
    if (grid.minor > 0.99) lay(grid.fine);
    return { at: [...out].sort((a, b) => a - b), grid };
  };

  it("subdivides at each level: the fine marks become the main ones", () => {
    const before = marks(12_345.6, 5 ** 2 * 0.999999);
    const after = marks(12_345.6, 5 ** 2);
    expect(before.grid.minor).toBeGreaterThan(0.99);
    expect(after.grid.minor).toBe(0);
    expect(after.at.length).toBeGreaterThan(5);
    expect(after.at).toEqual(before.at);
  });

  it("keeps its numbers small however far the map has moved", () => {
    const { main, fine } = gridAt(-987_654_321.5, 123_456_789.25, 37.2);
    for (const tile of [main, fine]) {
      expect(Math.abs(tile.x)).toBeLessThan(tile.size);
      expect(Math.abs(tile.y)).toBeLessThan(tile.size);
    }
  });
});
