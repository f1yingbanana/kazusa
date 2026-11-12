"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePlace } from "@/hooks/use-location";
import { useSceneSession } from "@/hooks/use-scene";
import {
  applySceneEvent,
  useSceneNextShowAt,
  useScenePlace,
} from "@/lib/live/scene-state";
import { NARROW_SLOTS, slotCount, type SlotCount } from "@/lib/scene/layout";
import type { ChatInfo } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import type { ReadingStatus } from "./use-reading-mode";
import { DomRenderer } from "./dom-renderer";

/** A timer set for a line's turn fires at or after it, never just before. */
const ADVANCE_SLACK_MS = 5;
/** What a click or a key on is its own, not a request for the next line. */
const OWN_CLICK =
  "button, a, input, textarea, select, label, [data-notice], [data-reply], [data-echo]";
const TEXT_FIELD = "input, textarea, select, [contenteditable]";
const PRESSABLE =
  "button, a, summary, [role=button], [role=radio], [role=checkbox], [role=tab]";
const ADVANCE_KEYS = new Set([" ", "Enter", "ArrowRight"]);

/**
 * A huddle as people in a place: keeps the chat's scene open while mounted,
 * measures whether it has five slots or one (`slotCount`), shows waiting lines
 * when their turn comes, and draws it with the DOM renderer. Mount it only for
 * the open huddle: its figures fetch their portraits. It fills all the room it
 * is given, down to the bottom edge: the reply box is inside its panel.
 */
export function SceneView({
  chat,
  loading = false,
  notice,
  footer,
  reading,
  onAdvance,
  onBacklog,
  advanceable = true,
}: {
  chat: Pick<ChatInfo, "id" | "name" | "placeId">;
  /** Its history is still being read. */
  loading?: boolean;
  /** Above the dialogue panel: why nobody answers. */
  notice?: ReactNode;
  /** The dialogue panel's foot: the reply box, or a read-only caption. */
  footer?: ReactNode;
  /** Reading mode: lines wait for the reader; what the panel says. */
  reading?: ReadingStatus;
  /**
   * The reader asks for the next line: a click or tap on the scene or the panel
   * (not on a control, the reply row or an echo), or Space, Enter or → with
   * focus in the stage but not in a text field (Space and Enter not on a button
   * either). Given only in reading mode, while nothing covers the scene; while
   * it would do something the whole scene shows the pointer.
   */
  onAdvance?: () => void;
  /** Opens the backlog (from an echo). */
  onBacklog?: () => void;
  /** An advance would do something now. */
  advanceable?: boolean;
}) {
  const chatId = chat.id;
  const ref = useRef<HTMLDivElement>(null);
  // Unknown until measured: the scene opens with the right count, so nobody
  // walks in because the first guess was wrong.
  const [slots, setSlots] = useState<SlotCount | undefined>(undefined);
  // The scene's height in px: every figure is drawn at one scale from it.
  const [sceneHeight, setSceneHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = ({ width, height }: { width: number; height: number }) => {
      if (!(width > 0)) return;
      const count = slotCount({ width, height });
      setSlots(count);
      // Whole pixels, so a resize re-lays the figures only when it shows.
      setSceneHeight(height > 0 ? Math.round(height) : undefined);
    };
    measure(element.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Opened once the latest history has been read too, so the first figures
  // are the latest to have spoken (the one slot's figure is the newest line's
  // author) rather than a guess replaced a moment later.
  useSceneSession(
    slots === undefined || loading ? null : chatId,
    slots ?? NARROW_SLOTS,
  );

  // Lines waiting their turn (catching up): show each when it comes.
  const nextShowAt = useSceneNextShowAt(chatId);
  useEffect(() => {
    if (nextShowAt === undefined) return;
    const timer = setTimeout(
      () => applySceneEvent(chatId, { type: "advance", at: Date.now() }),
      Math.max(0, nextShowAt - Date.now()) + ADVANCE_SLACK_MS,
    );
    return () => clearTimeout(timer);
  }, [chatId, nextShowAt]);

  // Keys ask for the next line from anywhere in the stage.
  const advanced = useEffectEvent(() => onAdvance?.());
  const advancing = onAdvance !== undefined;
  useEffect(() => {
    if (!advancing) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        !ADVANCE_KEYS.has(event.key) ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(TEXT_FIELD)) return;
      if (event.key !== "ArrowRight" && target.closest(PRESSABLE)) return;
      const stage = ref.current?.closest("[data-fullscreen]") ?? ref.current;
      if (target !== document.body && !stage?.contains(target)) return;
      event.preventDefault();
      advanced();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [advancing]);
  const click = (event: MouseEvent) => {
    if (!onAdvance) return;
    if (event.target instanceof Element && event.target.closest(OWN_CLICK))
      return;
    // Selecting the line's text is reading it, not asking for more.
    if (window.getSelection()?.toString()) return;
    onAdvance();
  };

  const placeId = useScenePlace(chatId) ?? chat.placeId;
  const placeName = usePlace(placeId)?.name ?? (chat.name || "In person");

  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Scene at ${placeName}`}
      data-slots={slots}
      data-mode={reading ? "reading" : "live"}
      className={cn(
        "relative isolate min-h-0 flex-1 overflow-hidden",
        onAdvance && advanceable && "cursor-pointer",
      )}
      onClick={click}
    >
      {slots === undefined ? null : (
        <DomRenderer
          chatId={chatId}
          placeId={placeId}
          slots={slots}
          sceneHeight={sceneHeight}
          loading={loading}
          notice={notice}
          footer={footer}
          reading={reading}
          onBacklog={onBacklog}
        />
      )}
    </div>
  );
}
