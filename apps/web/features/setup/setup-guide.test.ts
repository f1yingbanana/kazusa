// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SetupStatus, WorldOption } from "@/lib/setup/setup";
import { resetPreferences } from "@/lib/state/preferences-store";
import { createAgent } from "@/ui/agent";
import { OwnerGate } from "./owner-gate";
import { SetupGuide } from "./setup-guide";
import { StartOver } from "./start-over";

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
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
});

beforeEach(() => {
  resetPreferences();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

const WORLD_WITH_DEFAULT: WorldOption = {
  id: "kivotos",
  downloaded: true,
  title: "Kivotos",
  description: "Students and clubs.",
  systemAgent: "arona",
  groupNames: {
    sweets: "After-School Sweets Club",
    trinity: "Trinity General School",
  },
  groups: [
    {
      field: "groups",
      groups: [
        { name: "After-School Sweets Club", ids: ["airi", "kazusa"] },
        { name: "Trinity General School", ids: ["airi", "kazusa", "hifumi"] },
      ],
    },
  ],
  defaultCast: ["airi", "kazusa"],
  defaultUserCharacter: "kazusa",
  characters: [
    {
      id: "airi",
      name: "Airi Kurimura",
      summary: "Loves mint-chocolate ice cream.",
      groups: ["sweets", "trinity"],
      aliases: ["mint"],
    },
    {
      id: "hifumi",
      name: "Hifumi Ajitani",
      summary: "Admires Peroro-sama.",
      groups: ["trinity"],
    },
    {
      id: "kazusa",
      name: "Kazusa Kyouyama",
      summary: "Cool and aloof sweets club member.",
      groups: ["sweets", "trinity"],
    },
  ],
};

function makeStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    configured: false,
    worlds: [WORLD_WITH_DEFAULT],
    providers: [
      {
        id: "openrp",
        label: "OpenRP",
        keysUrl: "https://openrp.ai/settings/api-keys",
      },
      { id: "openrouter", label: "OpenRouter" },
    ],
    savedKey: null,
    ...overrides,
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function bodyJson<T>(init: RequestInit | undefined): T {
  if (typeof init?.body !== "string")
    throw new Error("Expected JSON string request body");
  return JSON.parse(init.body) as T;
}

describe("SetupGuide", () => {
  it("removes the time step, pre-selects defaultUserCharacter, and submits play as defaultUserCharacter", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (urlOf(input) === "/setup") {
          return Response.json({ ok: true });
        }
        return Response.json({ chats: [] });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(SetupGuide, { status: makeStatus() }));

    // Step 1: World (initially 2 steps until a world with a cast is chosen)
    expect(
      screen
        .getByRole("button", { name: "World" })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.queryByRole("button", { name: "Onstage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Time" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Kivotos/ }));
    expect(screen.getByRole("button", { name: "Characters" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 2: Characters (CastPicker with shared ClubGroupItem + Character Card)
    expect(screen.getByText("Who starts active?")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Show people in After-School Sweets Club",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("2/2")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Airi Kurimura" }).textContent,
    ).toContain("Loves mint-chocolate ice cream.");

    // Preview Hifumi by expanding Trinity General School and clicking her row, then toggle via card button.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show people in Trinity General School",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hifumi Ajitani" }));
    expect(
      screen.getByRole("region", { name: "Hifumi Ajitani" }).textContent,
    ).toContain("Admires Peroro-sama.");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("3 active")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 active")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recommended" }));
    expect(screen.getByText("2 active")).toBeTruthy();

    // Toggle Trinity General School group via its + button.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select Trinity General School",
      }),
    );
    expect(screen.getByText("3 active")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: Play as (pre-selected to world.defaultUserCharacter = kazusa)
    expect(screen.getByText("Who do you play?")).toBeTruthy();
    const kazusaCard = screen.getByRole("region", {
      name: "Kazusa Kyouyama",
    });
    expect(kazusaCard.textContent).toContain(
      "Cool and aloof sweets club member.",
    );
    expect(kazusaCard.textContent).toContain(
      "After-School Sweets Club · Trinity General School",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 4: Connect a model provider (skip key)
    expect(screen.getByText("Connect a model provider")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Skip for now, or use another provider",
      }),
    );
    expect(screen.getByText("Characters can't think yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/setup",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const setupCall = fetchMock.mock.calls.find(
      ([url]) => urlOf(url) === "/setup",
    );
    const body = bodyJson<{
      world: string;
      cast: string[];
      play?: string;
      startAt?: string;
    }>(setupCall?.[1]);
    expect(body.world).toBe("kivotos");
    expect(body.cast.sort()).toEqual(["airi", "hifumi", "kazusa"]);
    expect(body.play).toBe("kazusa");
    expect(body.startAt).toBeUndefined();
  });

  it("applies defaultUserCharacter after downloading a fresh world", async () => {
    const undownloaded: WorldOption = {
      id: "kivotos",
      downloaded: false,
      title: "Kivotos",
      description: "Students and clubs.",
      systemAgent: "arona",
      characters: [],
      groups: [],
      defaultCast: [],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (urlOf(input) === "/setup/world") {
          return Response.json(WORLD_WITH_DEFAULT);
        }
        if (urlOf(input) === "/setup") {
          return Response.json({ ok: true });
        }
        return Response.json({ progress: null });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(SetupGuide, {
        status: makeStatus({
          worlds: [undownloaded],
          savedKey: { id: "openrp", label: "OpenRP" },
        }),
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /Kivotos/ }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByRole("region", { name: "Kazusa Kyouyama" }),
    ).toBeTruthy();

    // Switch to Observer and verify play is omitted on submit.
    fireEvent.click(screen.getByRole("option", { name: /Observer/ }));
    expect(screen.getByRole("region", { name: "Observer" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      const setupCall = fetchMock.mock.calls.find(
        ([url]) => urlOf(url) === "/setup",
      );
      expect(setupCall).toBeTruthy();
      const body = bodyJson<{ play?: string }>(setupCall?.[1]);
      expect(body.play).toBeUndefined();
    });
  });

  it("lets an agent inspect and operate SetupGuide controls", async () => {
    const agent = createAgent();
    render(createElement(SetupGuide, { status: makeStatus() }));

    const checkLabels = () => {
      const entries = agent
        .snapshot()
        .filter((entry) => !entry.offPage && entry.component !== "more");
      for (const entry of entries) {
        expect(entry.label).toBeTruthy();
      }
      return entries.map((entry) => entry.label);
    };

    expect(checkLabels()).toContain("World");
    const chooseWorld = await agent.act({
      steps: [
        { ref: "World", action: "setValue", args: ["kivotos"] },
        { ref: "Next", action: "press" },
      ],
    });
    expect(chooseWorld.error).toBeUndefined();
    expect(chooseWorld.ok).toBe(true);

    const castLabels = checkLabels();
    expect(castLabels).toContain("Search characters and groups");
    expect(castLabels).toContain("Remove After-School Sweets Club");
    expect(castLabels).toContain("Remove Airi Kurimura");

    const toggleMember = await agent.act({
      steps: [
        { ref: "Remove Airi Kurimura", action: "press" },
        { ref: "Next", action: "press" },
      ],
    });
    expect(toggleMember.error).toBeUndefined();
    expect(toggleMember.ok).toBe(true);

    const playLabels = checkLabels();
    expect(playLabels).toContain("Who to play");
    const pickObserver = await agent.act({
      steps: [
        { ref: "Who to play", action: "setValue", args: [":observer"] },
        { ref: "Next", action: "press" },
      ],
    });
    expect(pickObserver.error).toBeUndefined();
    expect(pickObserver.ok).toBe(true);

    const keyLabels = checkLabels();
    expect(keyLabels).toContain("Model provider");
    expect(keyLabels).toContain("OpenRP API key");
    const enterKey = await agent.act({
      steps: [
        { ref: "Model provider", action: "setValue", args: ["openrouter"] },
        { ref: "OpenRouter API key", action: "setValue", args: ["sk-or-test"] },
      ],
    });
    expect(enterKey.error).toBeUndefined();
    expect(enterKey.ok).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>("OpenRouter API key").value,
    ).toBe("sk-or-test");
  });

  it("renders StartOver and OwnerGate with accessible controls", async () => {
    const agent = createAgent();
    render(createElement(StartOver));
    expect(
      screen.getByRole("button", { name: "Start a new world" }),
    ).toBeTruthy();
    cleanup();

    render(createElement(OwnerGate));
    const labels = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more")
      .map((entry) => entry.label);
    expect(labels).toContain("Gateway token");
    expect(labels).toContain("Sign in");

    await act(async () => {
      const res = await agent.act({
        steps: [
          { ref: "Gateway token", action: "setValue", args: ["tok-123"] },
        ],
      });
      expect(res.error).toBeUndefined();
      expect(res.ok).toBe(true);
    });
    expect(screen.getByLabelText<HTMLInputElement>("Gateway token").value).toBe(
      "tok-123",
    );
  });

  it("asks confirmation before switching away from an active download", async () => {
    let abortFirst: (() => void) | undefined;
    const deleted: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const target = urlOf(input);
      if (target === "/setup/world" && init?.method === "DELETE") {
        deleted.push("DELETE");
        abortFirst?.();
        return Promise.resolve(Response.json({ ok: true }));
      }
      if (target === "/setup/world" && init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          abortFirst = () => reject(new DOMException("Aborted", "AbortError"));
          init.signal?.addEventListener("abort", () => abortFirst?.());
        });
      }
      return Promise.resolve(Response.json({ progress: null }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const starter: WorldOption = {
      id: "starter",
      downloaded: true,
      title: "Start from scratch",
      description: "Empty starter world.",
      systemAgent: "arona",
      characters: [],
      groups: [],
      defaultCast: [],
    };
    const remote: WorldOption = {
      id: "kivotos",
      downloaded: false,
      title: "Kivotos",
      description: "Students and clubs.",
      systemAgent: "arona",
      characters: [],
      groups: [],
      defaultCast: [],
    };

    render(
      createElement(SetupGuide, {
        status: makeStatus({ worlds: [remote, starter] }),
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /Kivotos/ }));
    expect(
      screen
        .getByRole("radio", { name: /Start from scratch/ })
        .getAttribute("aria-disabled"),
    ).not.toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Start from scratch/ }));
    expect(screen.getByText("Switch world?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(deleted).toEqual(["DELETE"]);
      expect(
        screen
          .getByRole("radio", { name: /Start from scratch/ })
          .getAttribute("aria-checked"),
      ).toBe("true");
    });
  });

  it("scrolls the step pills horizontally and keeps the active step in view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(createElement(SetupGuide, { status: makeStatus() }));

    const nav = screen.getByRole("navigation", { name: "Setup steps" });
    expect(nav.className).toContain("overflow-x-auto");
    expect(nav.className).toContain("min-w-0");

    fireEvent.click(screen.getByRole("radio", { name: /Kivotos/ }));
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(
      screen.getByRole("button", { name: "Characters" }),
    );
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  });

  it("shows a spinner status instead of an indeterminate progress bar while starting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ ok: true }))),
    );

    render(createElement(SetupGuide, { status: makeStatus() }));

    fireEvent.click(screen.getByRole("radio", { name: /Kivotos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Skip for now, or use another provider",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(screen.getByText("Starting your world")).toBeTruthy();
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-ui-spin",
    );
  });
});
