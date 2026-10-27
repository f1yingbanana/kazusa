"use client";

import { useSyncExternalStore } from "react";
export type KazusaConfig = {
  baseUrl: string;
  userId: string;
  userName: string;
};

const STORAGE_KEY = "kazusa:connection";

export const DEFAULT_CONFIG: KazusaConfig = {
  baseUrl: process.env.NEXT_PUBLIC_KAZUSA_API_URL ?? "",
  userId: "user:sensei",
  userName: "Sensei",
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
        ? { ...DEFAULT_CONFIG, baseUrl: saved.baseUrl }
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
      JSON.stringify({ baseUrl: next.baseUrl }),
    );
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes); keep in memory.
  }
  for (const listener of listeners) listener();
}

export function useKazusaConfig() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CONFIG);
}
