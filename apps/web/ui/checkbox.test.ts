// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CheckList, CheckRow } from "./checkbox";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
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
});

afterEach(cleanup);

const agent = createAgent();

function FacetExample() {
  const [value, setValue] = useState<string[]>(["task.started"]);
  return createElement(
    CheckList<string>,
    {
      label: "Activities",
      allValues: ["task.started", "task.delayed", "task.stopped"],
      value,
      onValueChange: (next) => setValue([...next]),
    },
    createElement(CheckRow, { parent: true, label: "Activities" }),
    createElement(CheckRow, { value: "task.started", label: "Task started" }),
    createElement(CheckRow, { value: "task.delayed", label: "Task extended" }),
    createElement(CheckRow, { value: "task.stopped", label: "Task stopped" }),
  );
}

describe("CheckList and CheckRow", () => {
  it("supports mixed parent state, keyboard space, and agent actions", async () => {
    render(createElement(FacetExample));
    const parent = screen.getByRole("checkbox", { name: "Activities" });
    expect(parent.getAttribute("aria-checked")).toBe("mixed");

    fireEvent.keyDown(parent, { key: " " });
    fireEvent.click(parent);
    expect(parent.getAttribute("aria-checked")).toBe("true");

    const components = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of components) {
      expect(entry.label).toBeTruthy();
    }
    const labels = components.map((entry) => entry.label);
    expect(labels).toContain("Task extended");

    const res = await agent.act({
      steps: [{ ref: "Task extended", action: "setChecked", args: [false] }],
    });
    expect(res.error?.message).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(
      screen.getByRole("checkbox", { name: "Task extended" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(parent.getAttribute("aria-checked")).toBe("mixed");
  });
});
