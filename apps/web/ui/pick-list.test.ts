// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { filterPickGroups, PickList } from "./pick-list";

beforeAll(() => {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  document.elementsFromPoint = () => [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const agent = createAgent();

function People() {
  const [value, setValue] = useState<string[]>([]);
  return createElement(PickList, {
    label: "People",
    placeholder: "Find someone",
    value,
    onValueChange: setValue,
    groups: [
      {
        label: "Onstage",
        items: [
          { value: "airi", label: "Airi" },
          { value: "noa", label: "Noa" },
        ],
      },
      { label: "Offstage", items: [{ value: "yuuka", label: "Yuuka" }] },
    ],
  });
}

describe("PickList", () => {
  it("lets an agent pick people, who then show as removable chips", async () => {
    render(createElement(People));
    const labels = agent
      .snapshot()
      .filter((entry) => !entry.offPage)
      .map((entry) => entry.label);
    expect(labels).toContain("People");
    expect(labels).toContain("Search by name");

    const result = await agent.act({
      steps: [{ ref: "People", action: "setValue", args: [["Airi", "Yuuka"]] }],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    const picked = screen.getByRole("list", { name: "Picked" });
    expect(picked.textContent).toContain("Airi");
    expect(picked.textContent).toContain("Yuuka");
    expect(screen.getByRole("button", { name: "Remove Airi" })).toBeDefined();
  });

  it("filters grouped items by label or keyword and drops empty groups", () => {
    const groups = [
      {
        label: "Onstage",
        items: [
          { value: "airi", label: "Airi Kurimura", keywords: ["Mint"] },
          { value: "noa", label: "Noa Ushio" },
        ],
      },
      {
        label: "Offstage",
        items: [{ value: "yuuka", label: "Yuuka Hayase" }],
      },
    ];
    expect(filterPickGroups(groups, "mint")).toEqual([
      {
        label: "Onstage",
        items: [{ value: "airi", label: "Airi Kurimura", keywords: ["Mint"] }],
      },
    ]);
  });
});
