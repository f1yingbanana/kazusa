// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WikiSourceResponse } from "@kazusa/client";
import { WikiConflictError } from "../source/wiki/http";
import { PageEditor } from "../../components/views/wiki/page-editor";

const hooks = vi.hoisted(() => ({
  resource: {
    data: undefined as WikiSourceResponse | undefined,
    error: undefined as Error | undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn<() => Promise<WikiSourceResponse | undefined>>(),
  },
  save: vi.fn(),
}));
vi.mock("../../hooks/use-wiki", () => ({
  useWikiSource: () => hooks.resource,
  useSaveWikiPage: () => hooks.save,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const original: WikiSourceResponse = {
  id: "plaza",
  path: "entities/places/plaza.md",
  text: "# The plaza",
  exists: true,
  hash: "original",
};
const latest = { ...original, text: "# Updated plaza", hash: "latest" };
const editor = () =>
  createElement(PageEditor, {
    id: "plaza",
    side: "world",
    name: "Plaza",
    onDone: vi.fn(),
  });

beforeEach(() => {
  hooks.resource.data = original;
  hooks.resource.error = undefined;
  hooks.resource.isLoading = false;
  hooks.resource.isValidating = false;
  hooks.resource.mutate.mockReset();
  hooks.save.mockReset().mockResolvedValue(original);
});
afterEach(cleanup);

describe("wiki editor snapshots", () => {
  it("waits for the opening fetch and preserves the draft and base during cache refreshes", async () => {
    hooks.resource.isValidating = true;
    const view = render(editor());
    expect(screen.queryByRole("textbox")).toBeNull();
    hooks.resource.data = latest;
    hooks.resource.isValidating = false;
    view.rerender(editor());
    const input = await screen.findByRole("textbox");
    expect((input as HTMLTextAreaElement).value).toBe(latest.text);
    fireEvent.change(input, { target: { value: "My unsaved draft" } });

    hooks.resource.isValidating = true;
    view.rerender(editor());
    expect(screen.getByRole("textbox")).toBe(input);
    hooks.resource.data = {
      ...latest,
      text: "A concurrent edit",
      hash: "newer",
    };
    hooks.resource.isValidating = false;
    view.rerender(editor());
    expect((input as HTMLTextAreaElement).value).toBe("My unsaved draft");
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    await waitFor(() =>
      expect(hooks.save).toHaveBeenCalledWith({
        id: "plaza",
        text: "My unsaved draft",
        base: "latest",
      }),
    );
  });

  it("replaces the draft and base only when the user loads a conflicting version", async () => {
    hooks.save.mockRejectedValueOnce(new WikiConflictError("Page changed"));
    hooks.resource.mutate.mockResolvedValue(latest);
    render(editor());
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "My edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    const reload = await screen.findByRole("button", {
      name: "Load their version",
    });
    fireEvent.click(reload);
    await waitFor(() =>
      expect((input as HTMLTextAreaElement).value).toBe(latest.text),
    );
    expect(
      screen.queryByText("This page changed since you opened it"),
    ).toBeNull();
    fireEvent.change(input, { target: { value: "Resolved edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    await waitFor(() =>
      expect(hooks.save).toHaveBeenLastCalledWith({
        id: "plaza",
        text: "Resolved edit",
        base: "latest",
      }),
    );
  });
});
