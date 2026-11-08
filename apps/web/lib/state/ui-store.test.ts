// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linkedSearch = "?view=chats&chats.id=club&sel=character:alice";

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, "", `/${linkedSearch}`);
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("initial linked selection", () => {
  it("honors the selection once without notifying UI subscribers", async () => {
    const { keepsLinkedSelection, useUiStore } = await import("./ui-store");
    const listener = vi.fn();
    const unsubscribe = useUiStore.subscribe(listener);
    expect(keepsLinkedSelection("chats.id")).toBe(true);
    expect(keepsLinkedSelection("chats.id")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not apply the initial selection after navigation", async () => {
    const { keepsLinkedSelection } = await import("./ui-store");
    window.history.replaceState(null, "", "/?view=chats&chats.id=other");
    expect(keepsLinkedSelection("chats.id")).toBe(false);
    window.history.replaceState(null, "", `/${linkedSearch}`);
    expect(keepsLinkedSelection("chats.id")).toBe(false);
  });

  it("requires both an explicit selection and the feature's URL parameter", async () => {
    window.history.replaceState(null, "", "/?view=chats&chats.id=club");
    const { keepsLinkedSelection } = await import("./ui-store");
    expect(keepsLinkedSelection("chats.id")).toBe(false);
  });
});
