// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { WikiListItem, WikiPageForm } from "@kazusa/client";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgent } from "@/ui/agent";
import { PageEditor } from "./page-editor";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const form: WikiPageForm = {
  id: "seminar",
  kind: "concept",
  exists: true,
  hash: "h1",
  fields: {
    name: "Seminar",
    aliases: [],
    groups: [{ ref: "everyone", level: "heard of" }],
    group: true,
  },
  kept: [],
  other: [],
  lead: "Seminar is Millennium's student council.",
  close: "",
  only: "",
  members: [{ id: "yuuka", name: "Yuuka", level: "close" }],
};

const pages: WikiListItem[] = [
  {
    id: "seminar",
    kind: "concept",
    name: "Seminar",
    aliases: [],
    summary: "",
    group: true,
  },
  { id: "yuuka", kind: "person", name: "Yuuka", aliases: [], summary: "" },
  { id: "noa", kind: "person", name: "Noa", aliases: [], summary: "" },
];

const mocks = vi.hoisted(() => ({ saveWikiForm: vi.fn() }));

vi.mock("@/hooks/use-wiki-editor", () => ({
  useWikiForm: () => ({
    data: form,
    isValidating: false,
    error: undefined,
    mutate: vi.fn(),
  }),
  useWikiReach: () => ({
    data: {
      well: [{ id: "yuuka", name: "Yuuka" }],
      knows: [],
      heard: [],
      none: 3,
      members: [],
    },
  }),
}));
vi.mock("@/hooks/use-wiki", () => ({
  useWikiList: () => ({ data: { pages, upgraded: true } }),
  useSaveWikiPage: () => vi.fn(),
  useWikiSource: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-location", () => ({ usePlaces: () => null }));
vi.mock("@/lib/source/wiki/editor", () => ({
  saveWikiForm: mocks.saveWikiForm,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  window.matchMedia ??= () => ({ matches: false }) as MediaQueryList;
});

afterEach(cleanup);

describe("a page opened to be written", () => {
  it("lets an agent find every field by name, change the page and save it", async () => {
    const agent = createAgent();
    const onDone = vi.fn();
    mocks.saveWikiForm.mockResolvedValue({
      id: "seminar",
      path: "x",
      text: "",
      exists: true,
      hash: "h2",
    });
    render(
      createElement(PageEditor, {
        id: "seminar",
        name: "Seminar",
        side: "world",
        raw: false,
        onRaw: vi.fn(),
        onDone,
      }),
    );
    await screen.findByLabelText("Summary");

    const components = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of components)
      expect(
        entry.label,
        `${entry.component} ${entry.ref} has no name`,
      ).toBeTruthy();
    const labels = components.map((entry) => entry.label);
    for (const label of [
      "Name",
      "Also called",
      "Summary",
      "Opening",
      "For those close",
      "Save",
      "Add a member",
    ])
      expect(labels, `${label} is missing`).toContain(label);

    const result = await agent.act({
      steps: [
        {
          ref: "Summary",
          action: "setValue",
          args: ["The council that runs the money."],
        },
        {
          ref: "Also called",
          action: "setValue",
          args: ["the council, セミナー"],
        },
        { ref: "Save", action: "press" },
      ],
    });
    expect(result.error?.message ?? "ok").toBe("ok");
    await waitFor(() => expect(mocks.saveWikiForm).toHaveBeenCalled());
    const [payload] = mocks.saveWikiForm.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload).toMatchObject({
      id: "seminar",
      base: "h1",
      fields: {
        summary: "The council that runs the money.",
        aliases: ["the council", "セミナー"],
      },
      lead: form.lead,
      members: [{ id: "yuuka", level: "close" }],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("says who reads each layer beside its field", async () => {
    render(
      createElement(PageEditor, {
        id: "seminar",
        name: "Seminar",
        side: "world",
        raw: false,
        onRaw: vi.fn(),
        onDone: vi.fn(),
      }),
    );
    expect(await screen.findByText("1 has heard of it")).toBeTruthy();
    expect(screen.getByText("1 knows it well")).toBeTruthy();
  });
});
