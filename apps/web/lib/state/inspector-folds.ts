"use client";

import { useSyncExternalStore } from "react";

/**
 * Which inspector sections the viewer folded or opened, by section id. A UI
 * preference: it carries over from one character to the next, so folding Model
 * once keeps it out of the way everywhere.
 */
const STORAGE_KEY = "kazusa:inspector-folds";
const listeners = new Set<() => void>();
let cache: { raw: string | null; folds: Readonly<Record<string, boolean>> } = {
  raw: null,
  folds: {},
};

function read(): Readonly<Record<string, boolean>> {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cache.folds;
  }
  if (raw === cache.raw) return cache.folds;
  let folds: Record<string, boolean> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object")
      folds = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      );
  } catch {
    // A bad value is forgotten: every section falls back to its default.
  }
  cache = { raw, folds };
  return folds;
}

export function setSectionOpen(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...read(), [id]: open }),
    );
  } catch {
    // Without storage the choice lasts until the page reloads.
    cache = { raw: cache.raw, folds: { ...cache.folds, [id]: open } };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a section is open: the viewer's choice, else its default. */
export function useSectionOpen(id: string, fallback: boolean): boolean {
  const folds = useSyncExternalStore(subscribe, read, () => cache.folds);
  return folds[id] ?? fallback;
}
