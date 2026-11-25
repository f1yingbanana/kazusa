// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  Chronicle,
  ChronicleEntry,
  ChronicleMilestone,
  ChronicleMore,
  ChronicleThought,
} from "./timeline";

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

describe("Chronicle timeline primitive", () => {
  it("moves focus across events with arrow and page keys and toggles details", async () => {
    render(
      createElement(
        Chronicle,
        { label: "Events", busy: true },
        createElement(ChronicleEntry, {
          value: "1",
          time: "09:00",
          icon: createElement("span", { "aria-hidden": true }, "•"),
          title: "Airi started studying",
          description: createElement(
            ChronicleThought,
            { by: "Airi" },
            "Need to finish notes.",
          ),
        }),
        createElement(ChronicleMilestone, {
          value: "2",
          time: "08:30",
          icon: createElement("span", { "aria-hidden": true }, "⏱"),
          label: "Speed set to 10×",
        }),
        createElement(ChronicleEntry, {
          value: "3",
          time: "08:00",
          icon: createElement("span", { "aria-hidden": true }, "☾"),
          title: "Natsu slept on it",
          description: createElement(
            ChronicleMore,
            { summary: "2 pages rethought" },
            createElement("span", null, "cafe, library"),
          ),
        }),
      ),
    );

    const feed = screen.getByRole("feed", { name: "Events" });
    expect(feed.getAttribute("aria-busy")).toBe("true");

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(articles[0]?.getAttribute("data-first")).not.toBeNull();
    expect(articles[2]?.getAttribute("data-last")).not.toBeNull();

    articles[0]?.focus();
    expect(document.activeElement).toBe(articles[0]);
    fireEvent.keyDown(articles[0], { key: "PageDown" });
    expect(document.activeElement).toBe(articles[1]);
    fireEvent.keyDown(articles[1], { key: "PageUp" });
    expect(document.activeElement).toBe(articles[0]);

    const components = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of components) {
      expect(entry.label).toBeTruthy();
    }
    const labels = components.map((entry) => entry.label);
    expect(labels).toContain("2 pages rethought");

    const result = await agent.act({
      steps: [{ ref: "2 pages rethought", action: "open" }],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(screen.getByText("cafe, library")).toBeDefined();
  });
});
