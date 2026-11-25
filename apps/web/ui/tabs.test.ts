// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./tabs";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const agent = createAgent();

type Part = "about" | "people" | "looks";

function Profile({ onChange }: { onChange?: (value: Part) => void }) {
  const [value, setValue] = useState<Part>("about");
  return createElement(
    Tabs<Part>,
    {
      value,
      onValueChange: (next: Part | null) => {
        if (!next) return;
        setValue(next);
        onChange?.(next);
      },
    },
    createElement(TabsList, {
      label: "About Momoi",
      end: createElement("button", { type: "button" }, "Edit"),
      children: [
        createElement(TabsTab, { key: "a", value: "about", children: "About" }),
        createElement(TabsTab, {
          key: "p",
          value: "people",
          count: 9,
          children: "People",
        }),
        createElement(TabsTab, { key: "l", value: "looks", children: "Looks" }),
      ],
    }),
    createElement(TabsPanel, { value: "about" }, "Her page."),
    createElement(TabsPanel, { value: "people" }, "Who she knows."),
    createElement(TabsPanel, { value: "looks" }, "Her pictures."),
  );
}

describe("Tabs", () => {
  it("names the list, counts a tab and shows only the chosen panel", () => {
    render(createElement(Profile));
    expect(screen.getByRole("tablist", { name: "About Momoi" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "About" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: /People/ }).textContent).toBe(
      "People9",
    );
    expect(screen.getByText("Her page.")).toBeTruthy();
    expect(screen.queryByText("Who she knows.")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("moves with the arrow keys", () => {
    const changes: Part[] = [];
    render(createElement(Profile, { onChange: (v: Part) => changes.push(v) }));
    const about = screen.getByRole("tab", { name: "About" });
    about.focus();
    fireEvent.keyDown(about, { key: "ArrowRight" });
    expect(changes).toEqual(["people"]);
    expect(screen.getByText("Who she knows.")).toBeTruthy();
  });

  it("lets an agent choose a tab by its name", async () => {
    render(createElement(Profile));
    const tabs = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component === "tabs");
    expect(tabs.map((entry) => entry.label)).toEqual(["About Momoi"]);
    const result = await agent.act({
      steps: [{ ref: "About Momoi", action: "setValue", args: ["Looks"] }],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(screen.getByText("Her pictures.")).toBeTruthy();
  });
});
