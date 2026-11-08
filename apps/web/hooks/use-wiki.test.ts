// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSaveWikiPage, useWikiList, useWikiSource } from "./use-wiki";
import {
  fetchWikiList,
  fetchWikiSource,
  saveWikiSource,
} from "../lib/source/wiki/http";

vi.mock("./use-access", () => ({ useAccess: () => ({ canManage: true }) }));
vi.mock("../lib/source/provider", () => ({
  useSources: () => ({ resolved: { wiki: "live" } }),
}));
vi.mock("../lib/source/wiki/http", async (original) => ({
  ...(await original<typeof import("../lib/source/wiki/http")>()),
  fetchWikiList: vi.fn(),
  fetchWikiSource: vi.fn(),
  saveWikiSource: vi.fn(),
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

afterEach(cleanup);

describe("wiki editor resource", () => {
  it("refreshes lists after writes without changing another editor's base snapshot", async () => {
    const source = {
      id: "places/home",
      path: "wiki/places/home.md",
      exists: true,
      text: "Original",
      hash: "original",
    };
    vi.mocked(fetchWikiSource).mockResolvedValue(source);
    vi.mocked(fetchWikiList).mockResolvedValue({ pages: [] });
    vi.mocked(saveWikiSource).mockResolvedValue({
      ...source,
      id: "places/elsewhere",
      hash: "saved",
    });
    const { result } = renderHook(
      () => ({
        source: useWikiSource(source.id),
        list: useWikiList(),
        save: useSaveWikiPage(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.source.data).toEqual(source));
    expect(fetchWikiSource).toHaveBeenCalledOnce();
    await act(async () => {
      await result.current.save({ id: "places/elsewhere", text: "New" });
    });
    await waitFor(() => expect(fetchWikiList).toHaveBeenCalledTimes(2));
    expect(fetchWikiSource).toHaveBeenCalledOnce();
    expect(result.current.source.data).toEqual(source);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    expect(fetchWikiSource).toHaveBeenCalledOnce();
    expect(result.current.source.data).toEqual(source);
  });
});
