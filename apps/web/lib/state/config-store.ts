"use client";

import { useSyncExternalStore } from "react";

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

const listeners = new Set<() => void>();
let cached: KazusaConfig | null = null;

function read(): KazusaConfig {
  if (cached) return cached;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes).
  }
  cached = DEFAULT_CONFIG;
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveConfig(next: KazusaConfig) {
  cached = next;
  for (const listener of listeners) listener();
}

export function useKazusaConfig() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CONFIG);
}
