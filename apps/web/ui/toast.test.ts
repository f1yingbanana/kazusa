// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Toasts, toast } from "./toast";

describe("Toasts", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Element.prototype.getAnimations ??= () => [];
    toast.dismiss();
  });

  afterEach(() => {
    toast.dismiss();
    window.matchMedia = originalMatchMedia;
    cleanup();
  });

  it("anchors to bottom on narrow mobile viewports and top on desktop", () => {
    let mobile = true;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 767px") ? mobile : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    const view = render(createElement(Toasts));
    act(() => {
      toast.info("Kivotos 0.5.1 is out", {
        description: "88 KB to download.",
        action: { label: "View update", onAction: () => {} },
      });
    });

    const mobileRegion = screen.getByRole("region", { name: "Notifications" });
    expect(mobileRegion.getAttribute("data-side")).toBe("bottom");

    view.unmount();
    toast.dismiss();
    mobile = false;

    render(createElement(Toasts));
    act(() => {
      toast.info("Kivotos 0.5.1 is out");
    });

    const desktopRegion = screen.getByRole("region", {
      name: "Notifications",
    });
    expect(desktopRegion.getAttribute("data-side")).toBe("top");
  });
});
