// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, IconButton } from "./button";

afterEach(cleanup);

function spinner(button: HTMLElement) {
  return button.querySelector("svg.lucide-loader-circle");
}

describe("Button", () => {
  it("waits on a Promise from onClick, its label unchanged", async () => {
    let finish = () => {};
    render(
      createElement(
        Button,
        {
          tone: "primary",
          onClick: () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        },
        "Confirm",
      ),
    );
    const button = screen.getByRole("button", { name: "Confirm" });
    expect(button.hasAttribute("data-pending")).toBe(false);
    fireEvent.click(button);
    expect(button.hasAttribute("data-pending")).toBe(true);
    expect(spinner(button)).toBeTruthy();
    expect(button.textContent).toBe("Confirm");
    await act(async () => finish());
    expect(button.hasAttribute("data-pending")).toBe(false);
  });

  it("waits while `pending`, kept focusable and not pressable", () => {
    render(createElement(Button, { type: "submit", pending: true }, "Confirm"));
    const button = screen.getByRole("button", { name: "Confirm" });
    expect(button.hasAttribute("data-pending")).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toBe("Confirm");
  });

  it("shows a spinner on `IconButton` while `pending`", () => {
    render(
      createElement(
        IconButton,
        { label: "Save name", pending: true },
        createElement("span", null, "✓"),
      ),
    );
    const button = screen.getByRole("button", { name: "Save name" });
    expect(button.hasAttribute("data-pending")).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(spinner(button)).toBeTruthy();
  });
});
