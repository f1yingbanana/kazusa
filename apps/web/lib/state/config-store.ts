"use client";

import { useSyncExternalStore } from "react";
import type { MockMode } from "@/lib/source/capabilities";

export type KazusaConfig = {
  baseUrl: string;
  token?: string;
  /** Supplied by the server (`/kazusa/chats` user); never hardcoded lore. */
  userId: string;
  userName: string;
  mocks: MockMode;
};

const STORAGE_KEY = "kazusa:connection";
const MOCK_MODES: readonly MockMode[] = ["auto", "all", "off"];

function envMockMode(): MockMode {
  const value = process.env.NEXT_PUBLIC_KAZUSA_MOCKS;
  return MOCK_MODES.includes(value as MockMode) ? (value as MockMode) : "auto";
}

export const DEFAULT_CONFIG: KazusaConfig = {
  baseUrl: process.env.NEXT_PUBLIC_KAZUSA_API_URL ?? "",
  token: process.env.NEXT_PUBLIC_KAZUSA_TOKEN ?? "",
  userId: "user:you",
  userName: "You",
  mocks: envMockMode(),
};

const listeners = new Set<() => void>();
let cached: KazusaConfig | null = null;

function read(): KazusaConfig {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    cached =
      saved &&
      typeof saved === "object" &&
      "baseUrl" in saved &&
      typeof saved.baseUrl === "string"
        ? {
            ...DEFAULT_CONFIG,
            baseUrl: saved.baseUrl,
            token:
              "token" in saved && typeof saved.token === "string"
                ? saved.token
                : undefined,
            mocks:
              "mocks" in saved && MOCK_MODES.includes(saved.mocks as MockMode)
                ? (saved.mocks as MockMode)
                : DEFAULT_CONFIG.mocks,
          }
        : DEFAULT_CONFIG;
  } catch {
    cached = DEFAULT_CONFIG;
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveConfig(next: KazusaConfig) {
  cached = next;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        baseUrl: next.baseUrl,
        token: next.token ?? "",
        mocks: next.mocks,
      }),
    );
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes); keep in memory.
  }
  for (const listener of listeners) listener();
}

export function useKazusaConfig() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CONFIG);
}
