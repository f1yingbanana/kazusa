"use client";

import { create } from "zustand";

/** The configured player; the server supplies it (`/kazusa/chats` user). */
export type KazusaConfig = {
  userId: string;
  userName: string;
};

/** Older clients stored a Gateway URL and token here; never read it again. */
const LEGACY_STORAGE_KEY = "kazusa:connection";
export const DEFAULT_CONFIG: KazusaConfig = {
  userId: "user:you",
  userName: "You",
};

if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes).
  }
}

export interface ConfigState {
  readonly config: KazusaConfig;
}

export const useConfigStore = create<ConfigState>()(() => ({
  config: DEFAULT_CONFIG,
}));

export function saveConfig(next: KazusaConfig): void {
  useConfigStore.setState({ config: next });
}

export function useKazusaConfig(): KazusaConfig {
  return useConfigStore((state) => state.config);
}
