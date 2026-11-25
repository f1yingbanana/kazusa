// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Infobox, InfoboxRow } from "./infobox";

afterEach(cleanup);

describe("Infobox", () => {
  it("shows the picture whole, its caption and its facts", () => {
    render(
      createElement(Infobox, {
        label: "About Aoba",
        picture: { src: "/aoba.webp" },
        caption: "maid · happy",
        children: createElement(InfoboxRow, {
          term: "Also known as",
          children: "Aoba",
        }),
      }),
    );
    const box = screen.getByRole("complementary", { name: "About Aoba" });
    const img = box.querySelector("img")!;
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    expect(screen.getByText("maid · happy").tagName).toBe("FIGCAPTION");
    expect(screen.getByText("Also known as").tagName).toBe("DT");
  });

  it("shows facts alone without a picture", () => {
    render(
      createElement(Infobox, {
        label: "About Subaru",
        children: createElement(InfoboxRow, {
          term: "Groups",
          children: "Nicomedia Troop",
        }),
      }),
    );
    const box = screen.getByRole("complementary", { name: "About Subaru" });
    expect(box.querySelector("img")).toBeNull();
    expect(screen.getByText("Nicomedia Troop")).toBeTruthy();
  });

  it("is nothing with neither a picture nor facts", () => {
    const { container } = render(
      createElement(Infobox, {
        label: "About nobody",
        children: [null, false],
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides a broken picture while keeping facts, and recovers on a new picture", () => {
    const { rerender } = render(
      createElement(Infobox, {
        label: "About Aoba",
        picture: { src: "/broken.webp" },
        children: createElement(InfoboxRow, {
          term: "Groups",
          children: "Freight",
        }),
      }),
    );
    const box = screen.getByRole("complementary", { name: "About Aoba" });
    fireEvent.error(box.querySelector("img")!);
    expect(box.querySelector("img")).toBeNull();
    expect(screen.getByText("Freight")).toBeTruthy();

    rerender(
      createElement(Infobox, {
        label: "About Aoba",
        picture: { src: "/valid.webp" },
        children: createElement(InfoboxRow, {
          term: "Groups",
          children: "Freight",
        }),
      }),
    );
    expect(box.querySelector("img")?.getAttribute("src")).toBe("/valid.webp");
  });
});
