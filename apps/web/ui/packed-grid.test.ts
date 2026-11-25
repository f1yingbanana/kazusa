// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { columnsFor, PackedGrid, PackedGroup, PackedTile } from "./packed-grid";

let width = 0;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe("columnsFor", () => {
  it("fits as many columns as the width holds, one at least", () => {
    expect(columnsFor(0, 124, 12)).toBe(1);
    expect(columnsFor(124, 124, 12)).toBe(1);
    expect(columnsFor(259, 124, 12)).toBe(1);
    expect(columnsFor(260, 124, 12)).toBe(2);
    expect(columnsFor(1000, 124, 12)).toBe(7);
  });
});

describe("PackedGroup", () => {
  function group(label: string, count: number, minSpan = 1) {
    return createElement(PackedGroup, {
      key: label,
      label,
      count,
      minSpan,
      head: label,
      children: Array.from({ length: count }, (_, i) =>
        createElement(PackedTile, { key: i, children: `${label} ${i}` }),
      ),
    });
  }

  it("spans its tiles, the whole grid at most, and a row for its heading", () => {
    width = 3 * 124 + 2 * 12;
    render(
      createElement(PackedGrid, {
        min: 124,
        children: [
          group("Small", 2),
          group("Big", 7),
          group("A long name", 1, 2),
        ],
      }),
    );
    const small = screen.getByRole("group", { name: "Small" });
    const big = screen.getByRole("group", { name: "Big" });
    expect(small.style.gridColumn).toBe("span 2");
    expect(small.style.gridRow).toBe("span 2");
    expect(big.style.gridColumn).toBe("span 3");
    expect(big.style.gridRow).toBe("span 4");
    const long = screen.getByRole("group", { name: "A long name" });
    expect(long.style.gridColumn).toBe("span 2");
    expect(long.style.gridRow).toBe("span 2");
  });
});
