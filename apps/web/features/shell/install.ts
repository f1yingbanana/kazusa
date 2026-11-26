"use client";

import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/*
  The browser offers installing once, early, often before the menu mounts: keep
  its offer from the first moment this module runs.
*/
let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    offer = event as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    changed();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type InstallWay = "prompt" | "ios" | "installed" | "none";

function wayNow(): InstallWay {
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone
  )
    return "installed";
  if (offer) return "prompt";
  // Safari on an iPhone or iPad has no prompt: it's Share, then Add to Home Screen.
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return apple ? "ios" : "none";
}

/**
 * How this browser can put Kazusa on the home screen as its own app: its own
 * prompt, Safari's Share sheet (said in words), already done, or not at all.
 */
export function useInstall(): {
  way: InstallWay;
  install: () => Promise<void>;
} {
  const way = useSyncExternalStore(subscribe, wayNow, () => "none" as const);
  return {
    way,
    install: async () => {
      if (!offer) return;
      const asked = offer;
      await asked.prompt();
      await asked.userChoice;
      offer = null;
      changed();
    },
  };
}
