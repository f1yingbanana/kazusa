// @vitest-environment jsdom
import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgent } from "@/ui/agent";
import { Clock } from "./clock/clock";
import { SkipDialog } from "./clock/skip-dialog";
import { SocialLinks } from "./social-links";
import { StatusBar } from "./status-bar";

const mocks = vi.hoisted(() => ({
  role: "owner",
  watching: false,
  statuses: new Map<string, CharacterStatus>(),
  openPlayDialog: vi.fn(),
  openVisitorWelcome: vi.fn(),
}));

const CAST: CharacterSummary[] = [
  { id: "hina", name: "Hina", kind: "agent" } as CharacterSummary,
  { id: "aru", name: "Aru", kind: "agent" } as CharacterSummary,
];

vi.mock("@/hooks/use-access", () => ({
  useAccess: () => ({
    canPlay: mocks.role === "owner",
    canManage: mocks.role === "owner",
    canMaintain: false,
    isReadOnly: mocks.role === "visitor",
    isLoading: false,
    hasPermission: () => mocks.role === "owner",
  }),
}));

vi.mock("@/lib/source/provider", () => ({
  useSources: () => ({
    resolved: { status: "live", wiki: "unavailable", characters: "live" },
    player: mocks.watching
      ? { id: "", name: "" }
      : { id: "sensei", name: "Sensei" },
    watching: mocks.watching,
  }),
}));

vi.mock("@/lib/source/capabilities", () => ({
  satisfies: (resolved: Record<string, string>, requires: readonly string[]) =>
    requires.every((domain) => resolved[domain] === "live"),
}));

vi.mock("@/hooks/use-location", () => ({
  usePlayer: () => ({ placeId: "schale" }),
  usePlace: (id?: string) => (id ? { id, name: "Schale Office" } : undefined),
}));

vi.mock("@/hooks/use-characters", () => ({
  useCast: () => CAST,
  useCharacters: () => ({ byId: new Map(CAST.map((c) => [c.id, c])) }),
}));

vi.mock("@/lib/live/state", () => ({
  useLiveStore: (pick: (state: unknown) => unknown) =>
    pick({ statuses: mocks.statuses }),
}));

vi.mock("@/lib/live/realtime-state", () => ({
  useRealtimeStore: (pick: (state: unknown) => unknown) =>
    pick({ status: "open" }),
}));

vi.mock("@/lib/state/ui-store", () => ({
  openPlayDialog: mocks.openPlayDialog,
  openVisitorWelcome: mocks.openVisitorWelcome,
  openSavesDialog: vi.fn(),
}));

vi.mock("@/hooks/use-saves", () => ({
  useSaves: () => ({ enabled: true }),
}));

vi.mock("@/hooks/use-clock", () => ({
  useClockAnchor: () => ({
    clock: { simTime: Date.UTC(2026, 10, 20, 12, 0), speed: 1, updatedAt: 0 },
    offset: 0,
  }),
  useSimNow: () => Date.UTC(2026, 10, 20, 12, 0),
  useClockActions: () => ({ apply: vi.fn(), enabled: true }),
}));

vi.mock("../characters/character-avatar", () => ({
  CharacterAvatar: () => null,
}));

const agent = createAgent();

function wrap(node: ReactNode) {
  return createElement(NuqsTestingAdapter, null, node);
}

const busy = (patch: Partial<CharacterStatus>): CharacterStatus => ({
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
  ...patch,
});

beforeAll(() => {
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.checkVisibility = () => true;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= () => ({ matches: false }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  mocks.role = "owner";
  mocks.watching = false;
  mocks.statuses = new Map();
  vi.clearAllMocks();
});

describe("the status bar", () => {
  it("names every control, and draws only what can be pressed as a link", () => {
    mocks.statuses = new Map([
      ["hina", busy({ brain: "thinking" })],
      ["aru", busy({ queued: 2 })],
    ]);
    render(wrap(createElement(StatusBar)));
    const footer = screen.getByRole("contentinfo");

    const labels = agent
      .snapshot()
      .filter((entry) => !entry.offPage)
      .map((entry) => entry.label);
    expect(labels).toContain("Sensei");
    expect(labels).toContain("Schale Office");
    expect(labels).toContain("Who's busy: 1 thinking · 1 waiting");
    // "You are" and "at" only report.
    expect(
      within(footer).queryByRole("button", { name: /You are/ }),
    ).toBeNull();
    for (const button of within(footer).getAllByRole("button"))
      expect(button.className).toMatch(/text-ui-(primary|danger)/);
  });

  it("says all is quiet when nobody is busy", () => {
    render(wrap(createElement(StatusBar)));
    expect(screen.getByText("All quiet").closest("button")).toBeNull();
  });

  it("lets a visitor reopen what they were told on arriving", async () => {
    mocks.role = "visitor";
    mocks.watching = true;
    render(wrap(createElement(StatusBar)));
    const button = agent
      .snapshot()
      .find(
        (entry) =>
          entry.component === "button" && entry.label === "an observer",
      );
    const result = await agent.act({
      steps: [{ ref: button?.ref ?? "", action: "click" }],
    });
    expect(result.error).toBeUndefined();
    expect(mocks.openVisitorWelcome).toHaveBeenCalledOnce();
    expect(mocks.openPlayDialog).not.toHaveBeenCalled();
  });
});

describe("the warning before a big skip", () => {
  it("says who wakes and what it costs, and skips only when confirmed", async () => {
    const onSkip = vi.fn();
    render(
      wrap(
        createElement(SkipDialog, {
          open: true,
          onOpenChange: () => {},
          minutes: 480,
          landing: Date.UTC(2026, 10, 20, 20, 37),
          wakers: [
            { id: "hina", name: "Hina", type: "studying", endAt: 0 },
            { id: "aru", name: "Aru", type: "working", endAt: 0 },
          ],
          onSkip,
        }),
      ),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Skip 8 hours?")).toBeDefined();
    expect(within(dialog).getByText(/A burst of token use/)).toBeDefined();
    expect(within(dialog).getByText(/2 people \(Hina and Aru\)/)).toBeDefined();
    expect(within(dialog).getByText(/No undo/)).toBeDefined();
    const saveFirst = within(dialog).getByRole("button", {
      name: "Save first",
    });
    expect(saveFirst).toBeDefined();
    expect(saveFirst.parentElement?.className).not.toContain("me-auto");
    expect(onSkip).not.toHaveBeenCalled();
    within(dialog).getByRole("button", { name: "Confirm" }).click();
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

describe("clock next task and social links", () => {
  it("shows the task category icon once without repeating the 1-person summary", async () => {
    const now = Date.UTC(2026, 10, 20, 12, 0);
    mocks.statuses = new Map([
      [
        "hina",
        busy({
          task: {
            id: "t1",
            type: "studying",
            description: "Reading notes",
            startedAt: now - 60_000,
            endAt: now + 30 * 60_000,
          },
        }),
      ],
    ]);
    render(wrap(createElement(Clock)));
    fireEvent.click(screen.getByRole("button", { name: /Clock options/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Next" }));
    const summary = screen.getByText(/When Hina finishes/);
    expect(summary.textContent).toBe(
      "When Hina finishes studying and decides what's next.",
    );
    expect(summary.querySelector("svg")).not.toBeNull();
  });

  it("keeps social link icons clean without an overlaid external-link arrow", () => {
    render(wrap(createElement(SocialLinks)));
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.querySelectorAll("svg")).toHaveLength(1);
    }
  });
});
