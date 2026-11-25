// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ListRow } from "./list";
import { TalkGroup } from "./talk-group";

beforeAll(() => {
  Element.prototype.getAnimations = () => [];
  Element.prototype.checkVisibility = () => true;
});
afterEach(cleanup);

function group(props: { speaking?: string; onOpen?: () => void }) {
  return createElement(TalkGroup, {
    label: "Noa and Yuuka, talking",
    line: "Yuuka: Keep it in the margins.",
    openLabel: "Listen in",
    onOpen: props.onOpen ?? (() => {}),
    speaking: props.speaking,
    children: ["Noa", "Yuuka"].map((name) =>
      createElement(
        "li",
        { key: name },
        createElement(ListRow, { title: name, onClick: () => {} }),
      ),
    ),
  });
}

describe("TalkGroup", () => {
  it("holds its people, and its line opens the talk", () => {
    const open = vi.fn();
    render(group({ onOpen: open }));
    const box = screen.getByRole("group", { name: "Noa and Yuuka, talking" });
    expect(within(box).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: /^Listen in:.*margins/ }),
    );
    expect(open).toHaveBeenCalledOnce();
  });

  it("says who is speaking in place of the line", () => {
    render(group({ speaking: "Yuuka is speaking" }));
    const door = screen.getByRole("button", { name: /^Listen in/ });
    expect(door.textContent).toContain("Yuuka is speaking");
    expect(door.textContent).not.toContain("margins");
  });
});
