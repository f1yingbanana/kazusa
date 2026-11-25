// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ComposerBox } from "./composer";
import { LineActions } from "./line-actions";

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

function Box({
  onSubmit,
  closes,
}: {
  onSubmit: (text: string) => void;
  closes?: string;
}) {
  const [value, setValue] = useState("");
  return createElement(ComposerBox, {
    closes,
    value,
    onValueChange: setValue,
    onSubmit: () => {
      onSubmit(value);
      setValue("");
    },
    label: "Message",
    sendLabel: "Send message",
    placeholder: "Message Airi",
    canSend: value.trim().length > 0,
  });
}

describe("ComposerBox", () => {
  it("lets an agent write and send a message", async () => {
    const sent = vi.fn();
    render(createElement(Box, { onSubmit: sent }));
    const components = agent.snapshot().filter((entry) => !entry.offPage);
    for (const entry of components)
      expect({ ref: entry.ref, label: entry.label }).toMatchObject({
        label: expect.stringMatching(/\S/),
      });
    const labels = components.map((entry) => entry.label);
    expect(labels).toContain("Message");
    expect(labels).toContain("Send message");

    const result = await agent.act({
      steps: [
        { ref: "Message", action: "setValue", args: ["See you at lunch"] },
        { ref: "Send message", action: "press" },
      ],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(sent).toHaveBeenCalledWith("See you at lunch");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Message").value).toBe(
      "",
    );
  });

  it("sends on Enter, starts a line on Shift+Enter, and has nothing to send when empty", async () => {
    const sent = vi.fn();
    render(createElement(Box, { onSubmit: sent }));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Message");
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.hasAttribute("data-disabled")).toBe(true);

    await act(async () => {
      fireEvent.input(field, { target: { value: "hi" } });
    });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    });
    expect(sent).not.toHaveBeenCalled();
    expect(send.hasAttribute("data-disabled")).toBe(false);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(sent).toHaveBeenCalledWith("hi");
  });

  it("closes an asterisk typed first, steps over the close, and clears both", async () => {
    render(createElement(Box, { onSubmit: () => {}, closes: "*" }));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Message");
    await act(async () => {
      fireEvent.keyDown(field, { key: "*" });
    });
    expect(field.value).toBe("**");
    expect(field.selectionStart).toBe(1);

    await act(async () => {
      fireEvent.keyDown(field, { key: "Backspace" });
    });
    expect(field.value).toBe("");

    await act(async () => {
      fireEvent.keyDown(field, { key: "*" });
    });
    await act(async () => {
      fireEvent.input(field, { target: { value: "*waves*" } });
    });
    field.setSelectionRange(6, 6);
    await act(async () => {
      fireEvent.keyDown(field, { key: "*" });
    });
    expect(field.value).toBe("*waves*");
    expect(field.selectionStart).toBe(7);
  });

  it("pairs nothing unless asked", async () => {
    render(createElement(Box, { onSubmit: () => {} }));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Message");
    const typed = fireEvent.keyDown(field, { key: "*" });
    expect(typed).toBe(true);
    expect(field.value).toBe("");
  });
});

describe("LineActions", () => {
  it("names each action, and running one closes them", async () => {
    const copy = vi.fn();
    const close = vi.fn();
    render(
      createElement(LineActions, {
        open: true,
        onClose: close,
        actions: [
          { label: "Copy text", icon: null, run: copy },
          { label: "Screenshot", icon: null, run: () => {} },
        ],
      }),
    );
    const labels = agent
      .snapshot()
      .filter((entry) => !entry.offPage)
      .map((entry) => entry.label);
    expect(labels).toContain("Message actions");
    const result = await agent.act({
      steps: [{ ref: "Copy text", action: "press" }],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
  });
});
