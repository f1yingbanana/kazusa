// @vitest-environment jsdom
import type { VisitorNote } from "@kazusa/client";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VisitorWelcome } from "./visitor-welcome";

const mocks = vi.hoisted(() => ({
  visitor: true,
  note: undefined as VisitorNote | undefined,
}));

vi.mock("@/hooks/use-access", () => ({
  useAccess: () => ({ isReadOnly: mocks.visitor, isLoading: false }),
}));

vi.mock("@/lib/source/provider", () => ({
  useSources: () => ({
    world: { title: "Kivotos", visitorNote: mocks.note },
  }),
}));

beforeAll(() => {
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.checkVisibility = () => true;
  window.matchMedia ??= () => ({ matches: false }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mocks.visitor = true;
  mocks.note = undefined;
});

describe("the visitor welcome", () => {
  it("is this install's own note: its title, text and link", async () => {
    mocks.note = {
      title: "Talk to them on Discord",
      text: "Message one student at a time.",
      link: { label: "Join the Discord", href: "https://discord.gg/abc" },
    };
    render(createElement(VisitorWelcome));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("You're watching Kivotos")).toBeNull();
    expect(within(dialog).getByText("Talk to them on Discord")).toBeDefined();
    expect(within(dialog).getByText("Message one student at a time.")).toBeDefined();
    const link = within(dialog).getByRole("link", { name: "Join the Discord" });
    expect(link.getAttribute("href")).toBe("https://discord.gg/abc");
  });

  it("says only what every world says without one", async () => {
    render(createElement(VisitorWelcome));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Talk to them/)).toBeNull();
    expect(
      within(dialog).getByRole("link", { name: "GitHub" }),
    ).toBeDefined();
    expect(within(dialog).getByRole("link", { name: "Discord" })).toBeDefined();
  });

  it("is never shown to someone who can play", () => {
    mocks.visitor = false;
    render(createElement(VisitorWelcome));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
