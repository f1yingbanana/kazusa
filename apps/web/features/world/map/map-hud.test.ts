// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LookingAt } from "./map-hud";

afterEach(cleanup);

describe("LookingAt", () => {
  it("keeps the separator outside the truncated parent crumb and skips enter flash", () => {
    const { rerender } = render(
      createElement(LookingAt, {
        trail: ["Kivotos", "SCHALE Office", "SCHALE Basement"],
      }),
    );

    const status = screen.getByRole("status");
    const spans = Array.from(status.querySelectorAll("span"));
    expect(spans.map((span) => span.textContent)).toEqual([
      "Kivotos › SCHALE Office",
      "›",
      "SCHALE Basement",
    ]);
    expect(spans[0]?.className).toContain("truncate");
    expect(spans[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(spans[1]?.className).toContain("shrink-0");
    for (const span of spans) {
      expect(span.className).not.toContain("animate-ui-enter");
    }

    rerender(createElement(LookingAt, { trail: ["SCHALE Office", "Lounge"] }));
    expect(status.textContent).toBe("SCHALE Office›Lounge");
  });
});
