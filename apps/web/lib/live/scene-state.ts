import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ObservedChat } from "@kazusa/client";
import {
  createScene,
  direct,
  litFigure,
  nextShowAt,
  type SceneEvent,
  type SceneSeed,
} from "../scene/director";
import type { Figure, SceneLine, SceneState } from "../scene/state";

/**
 * Open scenes by chat id. A scene exists only between `openScene` and
 * `closeScene` (its view mounting and unmounting); events for any other chat
 * are dropped.
 */
export interface SceneStoreState {
  readonly scenes: Readonly<Record<string, SceneState>>;
}

export const useSceneStore = create<SceneStoreState>()(() => ({ scenes: {} }));

/** Opens a scene from a seed; one already open for the chat is kept. */
export function openScene(seed: SceneSeed): void {
  useSceneStore.setState((state) =>
    state.scenes[seed.chatId]
      ? state
      : { scenes: { ...state.scenes, [seed.chatId]: createScene(seed) } },
  );
}

export function closeScene(chatId: string): void {
  useSceneStore.setState((state) => {
    if (!state.scenes[chatId]) return state;
    const scenes = { ...state.scenes };
    delete scenes[chatId];
    return { scenes };
  });
}

/** Applies one director event to a chat's open scene. */
export function applySceneEvent(chatId: string, event: SceneEvent): void {
  useSceneStore.setState((state) => {
    const scene = state.scenes[chatId];
    if (!scene) return state;
    const next = direct(scene, event);
    return next === scene
      ? state
      : { scenes: { ...state.scenes, [chatId]: next } };
  });
}

/**
 * Members from a chat list read, for the open scenes it lists. A chat that has
 * ended has nobody left in it. Chats not in the list are left as they are.
 */
export function syncSceneMembers(
  chats: readonly Pick<ObservedChat, "id" | "members" | "placeId" | "ended">[],
): void {
  useSceneStore.setState((state) => {
    let scenes: Record<string, SceneState> | undefined;
    for (const chat of chats) {
      const scene = state.scenes[chat.id];
      if (!scene) continue;
      const next = direct(scene, {
        type: "members",
        members: chat.ended ? [] : chat.members,
        placeId: chat.placeId,
      });
      if (next === scene) continue;
      scenes ??= { ...state.scenes };
      scenes[chat.id] = next;
    }
    return scenes ? { scenes } : state;
  });
}

/**
 * Who can be drawn, from a roster read, for every open scene (`drawableIds`;
 * none at all without the scene capability).
 */
export function syncSceneDrawable(ids: ReadonlySet<string>): void {
  useSceneStore.setState((state) => {
    let scenes: Record<string, SceneState> | undefined;
    for (const [chatId, scene] of Object.entries(state.scenes)) {
      const next = direct(scene, { type: "drawable", ids });
      if (next === scene) continue;
      scenes ??= { ...state.scenes };
      scenes[chatId] = next;
    }
    return scenes ? { scenes } : state;
  });
}

/** Nobody is speaking in any scene: the stream dropped or is starting over. */
export function silenceScenes(): void {
  useSceneStore.setState((state) => {
    let scenes: Record<string, SceneState> | undefined;
    for (const [chatId, scene] of Object.entries(state.scenes)) {
      const next = direct(scene, { type: "silence" });
      if (next === scene) continue;
      scenes ??= { ...state.scenes };
      scenes[chatId] = next;
    }
    return scenes ? { scenes } : state;
  });
}

const NO_FIGURES: readonly Figure[] = [];
const NO_LINES: readonly SceneLine[] = [];

export function useSceneOpen(chatId: string): boolean {
  return useSceneStore((state) => chatId in state.scenes);
}

export function useScenePlace(chatId: string): string | undefined {
  return useSceneStore((state) => state.scenes[chatId]?.placeId);
}

/** Who is drawn, leaving figures included, in a stable order. */
export function useSceneFigures(chatId: string): readonly Figure[] {
  return useSceneStore(
    useShallow((state) => state.scenes[chatId]?.figures ?? NO_FIGURES),
  );
}

/**
 * Who is lit: the drawn speaker of the panel's line; `undefined`, nobody is
 * dimmed.
 */
export function useSceneLit(chatId: string): string | undefined {
  return useSceneStore((state) => {
    const scene = state.scenes[chatId];
    return scene ? litFigure(scene) : undefined;
  });
}

/** The panel's line: the newest said, or one still being said. */
export function useSceneLine(chatId: string): SceneLine | undefined {
  return useSceneStore((state) => state.scenes[chatId]?.line);
}

/** What was just said, above the panel: oldest first. */
export function useSceneEchoes(chatId: string): readonly SceneLine[] {
  return useSceneStore((state) => state.scenes[chatId]?.echoes ?? NO_LINES);
}

/** How many lines are waiting to be shown: "N behind". */
export function useSceneBehind(chatId: string): number {
  return useSceneStore((state) => state.scenes[chatId]?.ahead.length ?? 0);
}

/**
 * Wall-clock ms at which to send `advance`; `undefined` with nothing waiting.
 * Only changes when the lines do, so a timer keyed on it is set once per line.
 */
export function useSceneNextShowAt(chatId: string): number | undefined {
  return useSceneStore((state) => {
    const scene = state.scenes[chatId];
    return scene ? nextShowAt(scene) : undefined;
  });
}
