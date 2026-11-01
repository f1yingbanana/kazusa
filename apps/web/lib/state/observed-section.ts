"use client";

import { useSyncExternalStore } from "react";

/** Whether Other chats is folded in the Chats sidebar. A UI preference. */
const STORAGE_KEY = "kazusa:observed-collapsed";
const listeners = new Set<() => void>();

function read() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setObservedCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Stays open next time when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useObservedCollapsed() {
  return useSyncExternalStore(subscribe, read, () => false);
}
