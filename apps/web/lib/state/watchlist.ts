"use client";

import { useSyncExternalStore } from "react";

/** Starred characters. A UI preference, not simulation data. */
const STORAGE_KEY = "kazusa:watchlist";
const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
let cached: readonly string[] | null = null;

function read(): readonly string[] {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(next: readonly string[]) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep in memory when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function toggleWatch(id: string) {
  const current = read();
  write(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWatchlist() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
