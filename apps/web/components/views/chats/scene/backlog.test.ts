// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Backlog } from "./backlog";

afterEach(cleanup);

describe("Backlog", () => {
  it("keeps Tab and Shift+Tab inside while it is open", () => {
    render(
      createElement(
        "div",
        null,
        createElement("button", null, "Behind"),
        createElement(Backlog, {
          onClose: vi.fn(),
          children: createElement("button", null, "In the transcript"),
        }),
        createElement("button", null, "After"),
      ),
    );
    const close = screen.getByRole("button", { name: "Close backlog" });
    const inside = screen.getByRole("button", { name: "In the transcript" });
    expect(document.activeElement).toBe(close);
    // Back from its first stop: round to its last, not to the scene behind.
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inside);
    fireEvent.keyDown(inside, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    // Focus that got out anyway comes back in on the next Tab.
    screen.getByRole("button", { name: "Behind" }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });
});
