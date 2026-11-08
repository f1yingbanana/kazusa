// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModels } from "./use-models";
import { useDecisionModels } from "./use-model-roles";
import { useContextSettings } from "./use-context-settings";
import {
  fetchModels,
  fetchDecisionModels,
  selectModel,
  selectDecisionModel,
} from "../lib/source/models/http";
import {
  fetchContextSettings,
  saveContextSettings,
} from "../lib/source/context/http";

const access = vi.hoisted(() => ({ canManage: false }));
vi.mock("./use-access", () => ({ useAccess: () => access }));
vi.mock("../lib/source/provider", () => ({
  useSources: () => ({ resolved: { models: "live", context: "live" } }),
}));
vi.mock("./use-characters", () => ({ useCharacter: () => undefined }));
vi.mock("../lib/source/models/http", async (original) => ({
  ...(await original<typeof import("../lib/source/models/http")>()),
  fetchModels: vi.fn(),
  fetchDecisionModels: vi.fn(),
  selectModel: vi.fn(),
  selectDecisionModel: vi.fn(),
}));
vi.mock("../lib/source/context/http", async (original) => ({
  ...(await original<typeof import("../lib/source/context/http")>()),
  fetchContextSettings: vi.fn(),
  saveContextSettings: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    {
      value: {
        provider: () => new Map(),
        dedupingInterval: 0,
        errorRetryCount: 0,
      },
    },
    children,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canManage = false;
  vi.mocked(fetchModels).mockResolvedValue({ models: [], providers: [] });
  vi.mocked(fetchDecisionModels).mockResolvedValue({
    current: "judge",
    options: [],
  });
  vi.mocked(selectModel).mockResolvedValue({ current: "model" });
  vi.mocked(selectDecisionModel).mockResolvedValue({
    current: "judge",
    options: [],
  });
  const settings = {
    shortTermHours: 24,
    ledgerMaxTokens: 1000,
    maxContextTokens: 16000,
    ledgerGridHours: 1,
    ledgerTrimTo: 0.8,
    onYourMindTokens: 100,
    peopleLimit: 10,
    placesLimit: 10,
    toolHistoryTokens: 100,
  };
  vi.mocked(fetchContextSettings).mockResolvedValue({
    inherited: settings,
    effective: settings,
    overrides: {},
  });
  vi.mocked(saveContextSettings).mockResolvedValue({
    inherited: settings,
    effective: settings,
    overrides: {},
  });
});
afterEach(cleanup);

describe("settings mutation access", () => {
  it("updates permission captured by actions when initial access resolves and is later revoked", async () => {
    const { result, rerender } = renderHook(
      () => ({
        models: useModels(),
        role: useDecisionModels(),
        context: useContextSettings(),
      }),
      { wrapper },
    );
    access.canManage = true;
    rerender();
    await waitFor(() => expect(result.current.models.data).toBeDefined());
    await act(async () => {
      expect(await result.current.models.select("model")).toBe(true);
      expect(await result.current.role.select("judge")).toBe(true);
      expect(await result.current.context.save({})).toBe(true);
    });
    expect(selectModel).toHaveBeenCalledOnce();
    expect(selectDecisionModel).toHaveBeenCalledOnce();
    expect(saveContextSettings).toHaveBeenCalledOnce();
    access.canManage = false;
    rerender();
    await act(async () => {
      expect(await result.current.models.select("another")).toBe(false);
      expect(await result.current.role.select("another")).toBe(false);
      expect(await result.current.context.save({})).toBe(false);
    });
    expect(selectModel).toHaveBeenCalledOnce();
    expect(selectDecisionModel).toHaveBeenCalledOnce();
    expect(saveContextSettings).toHaveBeenCalledOnce();
  });
});
