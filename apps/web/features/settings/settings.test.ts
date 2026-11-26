// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createAgent } from "@/ui/agent";
import { createElement } from "react";
import { SWRConfig } from "swr";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hasPermission } from "@kazusa/client";
import {
  resetPreferences,
  usePreferencesStore,
} from "@/lib/state/preferences-store";
import { AppearanceSettings } from "./appearance-settings";
import { filterAllowedCategories } from "./categories";
import { ChatAppsSettings } from "./chat-apps-settings";
import { ConnectionSettings } from "./connection-settings";
import { ContextSettings } from "./context-settings";
import { ModelSettings } from "./model-settings";
import { ProfileSettings } from "./profile-settings";
import { StateSettings } from "./state-settings";
import { UpdateSettings } from "./update-settings";
import { UsageSettings } from "./usage-settings";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";
import { act } from "react";
import {
  closeUpdateSaveDialog,
  openUpdateSaveDialog,
} from "@/lib/state/ui-store";
import {
  CharacterContextSection,
  CharacterModelSection,
} from "../characters/settings-folds";
import { TopBar } from "../shell/top-bar";
import { UpdateSaveDialog } from "./update-save-dialog";
import { useAppearance } from "../shell/use-palette";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const mocks = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  saveContext: vi.fn(),
  saveCatalog: vi.fn(),
  selectModel: vi.fn(),
  selectCharacter: vi.fn(),
  modelsError: undefined as Error | undefined,
  characterOverrides: {},
  saveBeforeUpdate: vi.fn(),
  askAdmin: vi.fn(),
  allowConfirm: true,
  access: {
    access: {
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: true,
    },
    role: "owner",
    permissions: ["observe", "play", "manage"],
    isLoading: false,
    canPlay: true,
    canManage: true,
    isReadOnly: false,
    isOwner: true,
    isLocal: true,
    canMaintain: true,
    hasPermission: () => true,
    mutate: vi.fn(),
  },
}));

vi.mock("@/hooks/use-access", () => ({
  useAccess: () => mocks.access,
}));

vi.mock("@/lib/source/provider", () => ({
  useSources: () => ({
    resolved: {
      world: "live",
      clock: "live",
      profile: "live",
      context: "live",
      models: "live",
      stats: "live",
      usage: "live",
      bridges: "live",
    },
    reachable: true,
    backendError: undefined,
    retryBackend: vi.fn(),
    world: undefined,
    worldResource: { mutate: vi.fn() },
    player: { id: "", name: "You" },
    watching: true,
    operator: { id: "user:sensei", name: "Sensei" },
    probing: false,
  }),
}));

vi.mock("@/lib/live/realtime-state", () => ({
  useRealtimeStore: (selector: (s: { status: "open" }) => unknown) =>
    selector({ status: "open" }),
}));

vi.mock("@/hooks/use-clock", () => ({
  useClockAnchor: () => null,
  useSimNow: () => 0,
  useClockActions: () => ({ apply: vi.fn(), enabled: false }),
}));

vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({
    enabled: true,
    data: { id: "user:sensei", name: "Sensei", about: "Initial notes" },
    error: undefined,
    save: mocks.saveProfile,
  }),
}));

vi.mock("@/hooks/use-context-settings", () => {
  const world = {
    maxContextTokens: 64000,
    shortTermHours: 16,
    ledgerMaxTokens: 16000,
    toolHistoryTokens: 1500,
    onYourMindTokens: 3000,
    peopleLimit: 20,
    placesLimit: 10,
    ledgerGridHours: 4,
    ledgerTrimTo: 0.75,
  };
  return {
    useContextSettings: (agentId?: string) => {
      const overrides = agentId ? mocks.characterOverrides : {};
      return {
        enabled: true,
        data: {
          effective: { ...world, ...overrides },
          inherited: world,
          overrides,
        },
        error: undefined,
        save: mocks.saveContext,
      };
    },
  };
});

vi.mock("@/hooks/use-saves", () => ({
  useSaves: () => ({
    enabled: true,
    supervised: true,
    request: undefined,
    saveBeforeUpdate: mocks.saveBeforeUpdate,
  }),
}));

vi.mock("@/hooks/use-models", () => ({
  useModels: (agentId?: string) => ({
    enabled: true,
    data:
      agentId && mocks.modelsError
        ? undefined
        : {
            scope: agentId ?? "default",
            current: "anthropic/claude-sonnet-4",
            thinking: "low",
            models: [
              {
                ref: "anthropic/claude-sonnet-4",
                name: "Claude Sonnet 4",
                provider: "anthropic",
                available: true,
                contextWindow: 200000,
                thinkingLevels: [
                  { id: "off", label: "Off" },
                  { id: "low", label: "Low" },
                  { id: "medium", label: "Medium" },
                  { id: "high", label: "High" },
                ],
              },
            ],
            providers: [{ provider: "anthropic", status: "ready" }],
          },
    error: agentId ? mocks.modelsError : undefined,
    refreshing: false,
    refresh: vi.fn(),
    select: mocks.selectModel,
    setThinking: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-model-roles", () => ({
  useDecisionModels: () => ({
    data: {
      configured: null,
      current: "anthropic/claude-sonnet-4",
      options: [
        {
          ref: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          provider: "anthropic",
          available: true,
        },
      ],
    },
    error: undefined,
    select: vi.fn(),
  }),
  useEmbeddingModels: () => ({
    data: {
      configured: null,
      current: undefined,
      options: [],
    },
    error: undefined,
    select: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-providers", () => ({
  useProviders: () => ({
    enabled: true,
    data: {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          key: "profile",
          local: true,
        },
      ],
    },
    error: undefined,
    saveKey: vi.fn(),
    removeKey: vi.fn(),
  }),
  useProviderLabel: () => (provider: string) =>
    provider === "anthropic" ? "Anthropic" : provider,
}));

vi.mock("@/hooks/use-stats", () => ({
  useStats: () => ({
    enabled: true,
    canManage: true,
    isLoading: false,
    error: undefined,
    data: {
      catalog: [
        {
          name: "mood",
          on: "character",
          kind: "number",
          changedBy: "character",
          shown: "self",
          description: "Current emotional tone",
          min: 0,
          max: 100,
          initial: 50,
          bands: [
            { name: "low", min: 0 },
            { name: "steady", min: 34 },
            { name: "upbeat", min: 67 },
          ],
        },
      ],
      revision: "rev-1",
    },
    stale: false,
    refresh: vi.fn(),
    saveCatalog: mocks.saveCatalog,
  }),
}));

vi.mock("@/hooks/use-bridges", () => ({
  useBridges: () => ({
    enabled: true,
    bridges: [
      {
        id: "discord",
        connected: false,
        configured: false,
        status: "disconnected",
        error: null,
        botName: null,
      },
    ],
    links: [],
    isLoading: false,
    error: undefined,
    connect: vi.fn(),
    disconnect: vi.fn(),
    link: vi.fn(),
    unlink: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-bridge-account", () => ({
  useBridgeAccount: () => ({
    data: { account: null, linked: false },
    mutate: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-observed-chats", () => ({
  useObservedChats: () => ({
    chats: [],
    error: undefined,
    isLoading: false,
    reload: vi.fn(),
    available: true,
  }),
}));

vi.mock("@/features/entities/chat-meta", () => ({
  useChatTitle: (id: string) => ({ title: id, icon: null }),
}));

vi.mock("@/hooks/use-brain", () => ({
  useUsage: () => ({
    data: {
      days: 30,
      sessionCount: 5,
      messages: { toolCalls: 2 },
      totals: {
        totalTokens: 12000,
        input: 8000,
        output: 4000,
        cacheRead: 1000,
        cacheWrite: 0,
        totalCost: 0.42,
        missingCostEntries: 0,
      },
      daily: [{ date: "2026-11-24", tokens: 12000, cost: 0.42 }],
      byAgent: [],
      byModel: [
        {
          provider: "anthropic",
          model: "claude-sonnet-4",
          count: 4,
          totals: { totalTokens: 12000, totalCost: 0.42 },
        },
      ],
    },
    error: undefined,
    isLoading: false,
    isValidating: false,
    settling: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-characters", () => ({
  useCharacter: (id?: string) =>
    id ? { id, name: "Hoshino", kind: "character" } : undefined,
  useCharacters: () => ({
    characters: [],
    byId: new Map(),
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock("@/hooks/use-selection", () => ({
  useSelection: () => [null, mocks.selectCharacter] as const,
}));

vi.mock("@/hooks/use-update", () => ({
  useUpdate: () => ({
    status: {
      current: { version: "0.9.0", branch: "main" },
      release: {
        version: "0.9.0",
        date: "2026-11-20T00:00:00Z",
        url: null,
        status: "current",
        installable: true,
      },
      development: {
        version: "abc1234",
        date: "2026-11-21T00:00:00Z",
        status: "older",
        installable: true,
      },
      blocked: null,
      error: null,
    },
    error: undefined,
    checking: false,
    phase: null,
    check: vi.fn(),
    update: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-world-update", () => ({
  offered: () => false,
  reasonOf: () => undefined,
  versionLabel: (version: { version?: string | null; commit: string }) =>
    version.version ?? version.commit.slice(0, 7),
  useWorldUpdate: () => ({
    update: undefined,
    admin: "System",
    known: false,
    canAsk: true,
    asking: false,
    ask: mocks.askAdmin,
  }),
  useWorldCheck: () => ({
    enabled: false,
    result: undefined,
    error: undefined,
    checking: false,
    check: vi.fn(),
    download: vi.fn(),
  }),
}));

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
  window.localStorage.clear();
  resetPreferences();
  mocks.modelsError = undefined;
  mocks.allowConfirm = true;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agent = createAgent({
  allow: (step) => !step.confirm || mocks.allowConfirm,
});

function assertEveryControlNamed() {
  const components = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components) {
    expect(
      entry.label,
      `${entry.component} ${entry.ref} has no name`,
    ).toBeTruthy();
  }
  return components.map((entry) => entry.label);
}

function wrapSWR(node: React.ReactNode) {
  return createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    node,
  );
}

describe("settings categories", () => {
  it("groups and restricts categories by viewer permission", () => {
    const visitor = filterAllowedCategories(
      (permission) => hasPermission("visitor", permission),
      false,
    ).map((item) => item.id);
    expect(visitor).toEqual(["connection", "appearance"]);

    const collaborator = filterAllowedCategories(
      (permission) => hasPermission("collaborator", permission),
      false,
    ).map((item) => item.id);
    expect(collaborator).toEqual(["connection", "appearance", "chat-apps"]);

    const owner = filterAllowedCategories(
      (permission) => hasPermission("owner", permission),
      true,
    ).map((item) => item.id);
    expect(owner).toEqual([
      "connection",
      "appearance",
      "profile",
      "models",
      "context",
      "states",
      "chat-apps",
      "usage",
      "updates",
    ]);
  });
});

describe("AppearanceSettings and TopBar", () => {
  it("lets an agent change color mode and palette and syncs <html>", async () => {
    function Harness() {
      useAppearance();
      return createElement(AppearanceSettings);
    }
    render(createElement(Harness));

    const labels = assertEveryControlNamed();
    expect(labels).toContain("Color mode");
    expect(labels).toContain("Color palette");

    const result = await agent.act({
      steps: [
        { ref: "Color mode", action: "setValue", args: ["Dark"] },
        { ref: "Color palette", action: "setValue", args: ["Crimson & Gold"] },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(usePreferencesStore.getState().themeMode).toBe("dark");
    expect(usePreferencesStore.getState().palette).toBe("crimson");
    expect(document.documentElement.dataset.palette).toBe("crimson");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("removes the theme toggle from TopBar", () => {
    render(
      createElement(TopBar, {
        onOpenCommand: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );
    expect(screen.queryByRole("button", { name: "Palette" })).toBeNull();
    expect(screen.getByRole("button", { name: "Search or jump" })).toBeTruthy();
  });
});

describe("ConnectionSettings", () => {
  it("lets an agent inspect and update the remote OpenClaw Gateway target", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/connection" && (!init?.method || init.method === "GET")) {
        return Response.json({
          url: "http://127.0.0.1:18789",
          hasToken: true,
          defaultUrl: "http://127.0.0.1:18789",
          isDefault: true,
        });
      }
      if (url === "/connection" && init?.method === "POST") {
        return Response.json({
          ok: true,
          url: "https://remote.example:18789",
          hasToken: true,
          defaultUrl: "http://127.0.0.1:18789",
          isDefault: false,
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(wrapSWR(createElement(ConnectionSettings)));
    await screen.findByDisplayValue("http://127.0.0.1:18789");

    const labels = assertEveryControlNamed();
    expect(labels).toContain("Gateway URL");
    expect(labels).toContain("Gateway token");
    expect(labels).toContain("Save and connect");

    const result = await agent.act({
      steps: [
        {
          ref: "Gateway URL",
          action: "setValue",
          args: ["https://remote.example:18789"],
        },
        {
          ref: "Gateway token",
          action: "setValue",
          args: ["remote-secret-token"],
        },
        { ref: "Save and connect", action: "press" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) => u === "/connection" && init?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const rawBody = postCall?.[1]?.body;
    expect(JSON.parse(typeof rawBody === "string" ? rawBody : "")).toEqual({
      url: "https://remote.example:18789",
      token: "remote-secret-token",
    });
    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});

describe("ProfileSettings and ContextSettings", () => {
  it("lets an agent update profile description", async () => {
    mocks.saveProfile.mockResolvedValue(undefined);
    render(wrapSWR(createElement(ProfileSettings)));

    const labels = assertEveryControlNamed();
    expect(labels).toContain("What the system agent knows about you");
    expect(labels).toContain("Save");

    const result = await agent.act({
      steps: [
        {
          ref: "What the system agent knows about you",
          action: "setValue",
          args: ["Updated operator bio"],
        },
        { ref: "Save", action: "press" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(mocks.saveProfile).toHaveBeenCalledWith("Updated operator bio");
  });

  it("lets an agent change context settings and save", async () => {
    mocks.saveContext.mockResolvedValue(true);
    render(wrapSWR(createElement(ContextSettings)));

    const labels = assertEveryControlNamed();
    expect(labels).toContain("Use the model's whole window");
    expect(labels).toContain("Maximum context");
    expect(labels).toContain("Memory window");
    expect(labels).toContain("People");

    const result = await agent.act({
      steps: [
        {
          ref: "Use the model's whole window",
          action: "setChecked",
          args: [true],
        },
        { ref: "People", action: "setValue", args: [25] },
        { ref: "Save changes", action: "press" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(mocks.saveContext).toHaveBeenCalledWith({
      maxContextTokens: "unlimited",
      peopleLimit: 25,
    });
  });
  it("validates cleared numeric fields in ContextSettings", async () => {
    render(wrapSWR(createElement(ContextSettings)));
    const result = await agent.act({
      steps: [
        { ref: "People", action: "setValue", args: [null] },
        { ref: "Save changes", action: "press" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(screen.getByText("Enter a number.")).toBeTruthy();
    expect(mocks.saveContext).not.toHaveBeenCalled();
  });
});

describe("remaining settings sections", () => {
  it("renders ModelSettings with strict accessible labels", () => {
    render(wrapSWR(createElement(ModelSettings)));
    const labels = assertEveryControlNamed();
    expect(labels).toContain("Chat model");
    expect(labels).toContain("Reasoning");
    expect(screen.getAllByText("Claude Sonnet 4").length).toBeGreaterThan(0);
  });

  it("renders StateSettings and lets an agent open, edit, and confirm deleting a state", async () => {
    mocks.saveCatalog.mockResolvedValue(undefined);
    render(wrapSWR(createElement(StateSettings)));
    const labels = assertEveryControlNamed();
    expect(labels).toContain("New state");
    expect(labels).toContain("Edit mood");

    let result = await agent.act({
      steps: [{ ref: "Edit mood", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "low from 0, steady from 34, upbeat from 67; starts at 50",
      }),
    ).toBeTruthy();

    mocks.allowConfirm = false;
    result = await agent.act({
      steps: [
        { ref: "Delete", action: "press" },
        { ref: "Delete Mood?", action: "press", args: ["Confirm"] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(mocks.saveCatalog).not.toHaveBeenCalled();

    mocks.allowConfirm = true;
    result = await agent.act({
      steps: [{ ref: "Delete Mood?", action: "press", args: ["Confirm"] }],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(mocks.saveCatalog).toHaveBeenCalledWith([], "rev-1");
  });

  it("renders ChatAppsSettings with strict accessible labels", () => {
    render(wrapSWR(createElement(ChatAppsSettings)));
    const labels = assertEveryControlNamed();
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.getByText("Discord")).toBeTruthy();
  });

  it("renders UsageSettings and UpdateSettings cleanly", () => {
    render(wrapSWR(createElement(UsageSettings)));
    let labels = assertEveryControlNamed();
    expect(labels).toContain("Date range");
    expect(screen.getAllByText("$0.4200").length).toBeGreaterThan(0);
    cleanup();

    render(wrapSWR(createElement(UpdateSettings)));
    labels = assertEveryControlNamed();
    expect(labels).toContain("Check again");
  });
});

describe("settings a character overrides", () => {
  const entity = { kind: "character", id: "hoshino" } as const;

  it("lets an agent take a character back to the world and own another value", async () => {
    mocks.characterOverrides = { peopleLimit: 30 };
    mocks.saveContext.mockResolvedValue(true);
    render(
      wrapSWR(
        createElement(
          withNuqsTestingAdapter(),
          null,
          createElement(CharacterContextSection, { entity }),
        ),
      ),
    );
    expect(screen.getByText("30 people")).toBeTruthy();

    let result = await agent.act({
      steps: [{ ref: "Customize", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(screen.getByRole("dialog")).toBeTruthy();
    const labels = assertEveryControlNamed();
    expect(labels).toContain("Use world default (20 people)");
    expect(labels).not.toContain("Use world default (10 places)");

    result = await agent.act({
      steps: [
        { ref: "Use world default (20 people)", action: "press" },
        { ref: "Places", action: "setValue", args: [12] },
        { ref: "Save changes", action: "press" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(mocks.saveContext).toHaveBeenCalledWith({ placesLimit: 12 });
    mocks.characterOverrides = {};
  });

  it("names a character's model pickers and links to the world defaults", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    render(
      wrapSWR(
        createElement(
          withNuqsTestingAdapter({ onUrlUpdate }),
          null,
          createElement(CharacterModelSection, { entity }),
        ),
      ),
    );
    const labels = assertEveryControlNamed();
    expect(labels).toContain("Chat model for Hoshino");
    expect(labels).toContain("Reasoning for Hoshino");
    expect(screen.getAllByText("Follows the world default.")).toHaveLength(2);

    const result = await agent.act({
      steps: [{ ref: "World defaults", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    const last = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(last?.searchParams.get("view")).toBe("settings");
    expect(last?.searchParams.get("settings.tab")).toBe("models");
  });

  it("lets an agent reset a character's model when loading fails", async () => {
    mocks.modelsError = new Error("Broken config");
    mocks.selectModel.mockResolvedValue(true);
    render(
      wrapSWR(
        createElement(
          withNuqsTestingAdapter(),
          null,
          createElement(CharacterModelSection, { entity }),
        ),
      ),
    );
    const result = await agent.act({
      steps: [{ ref: "Use world default", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(mocks.selectModel).toHaveBeenCalledWith(null);
  });
});

describe("UpdateSaveDialog", () => {
  afterEach(() => act(() => closeUpdateSaveDialog()));

  it("saves into the before-an-update slot when asked", async () => {
    mocks.saveBeforeUpdate.mockResolvedValue({ request: { id: "save-1" } });
    render(wrapSWR(createElement(UpdateSaveDialog)));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openUpdateSaveDialog());

    const labels = assertEveryControlNamed();
    expect(labels).toContain("Save, then update");
    expect(labels).toContain("Update without saving");
    const result = await agent.act({
      steps: [{ ref: "Save, then update", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(mocks.saveBeforeUpdate).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("kazusa.saves.ask-after")).toBe(
      "save-1",
    );
    expect(mocks.askAdmin).not.toHaveBeenCalled();
  });

  it("asks the system agent straight away without saving", async () => {
    mocks.askAdmin.mockResolvedValue(undefined);
    render(wrapSWR(createElement(UpdateSaveDialog)));
    act(() => openUpdateSaveDialog());
    const result = await agent.act({
      steps: [{ ref: "Update without saving", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(mocks.askAdmin).toHaveBeenCalledOnce();
    expect(mocks.saveBeforeUpdate).not.toHaveBeenCalled();
  });
});
