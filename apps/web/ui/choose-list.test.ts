// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ChooseList } from "./choose-list";
import type { PickGroup } from "./pick-list";

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

const groups: PickGroup[] = [
  { label: "Watch", items: [{ value: ":observer", label: "Observer" }] },
  {
    label: "Play",
    items: [
      { value: "momoi", label: "Momoi Saiba", keywords: ["Momoi"] },
      { value: "midori", label: "Midori Saiba" },
      { value: "yuzu", label: "Yuzu Hanaoka", disabled: true },
    ],
  },
];

function Example() {
  const [value, setValue] = useState(":observer");
  return createElement(
    "div",
    null,
    createElement(ChooseList, {
      label: "Who to play",
      groups,
      value,
      onValueChange: setValue,
      placeholder: "Search",
    }),
    createElement("output", null, value),
  );
}

describe("ChooseList", () => {
  it("chooses one by press, and finds by typing", () => {
    render(createElement(Example));
    fireEvent.click(screen.getByRole("option", { name: "Midori Saiba" }));
    expect(screen.getByRole("status").textContent).toBe("midori");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search by name" }),
      {
        target: { value: "momoi" },
      },
    );
    expect(screen.queryByRole("option", { name: "Midori Saiba" })).toBeNull();
    expect(screen.getByRole("option", { name: "Momoi Saiba" })).toBeTruthy();
  });

  it("lets an agent choose by name, not a disabled one", async () => {
    render(createElement(Example));
    const lists = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component === "listbox");
    expect(lists.map((entry) => entry.label)).toEqual(["Who to play"]);
    const result = await agent.act({
      steps: [
        { ref: "Who to play", action: "setValue", args: ["Momoi Saiba"] },
      ],
    });
    expect(result.error?.message).toBeUndefined();
    expect(screen.getByRole("status").textContent).toBe("momoi");
    const refused = await agent.act({
      steps: [
        { ref: "Who to play", action: "setValue", args: ["Yuzu Hanaoka"] },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("momoi");
  });
});
