"use client";

import type { ReactNode } from "react";
import { useSceneFigures, useSceneLit } from "@/lib/live/scene-state";
import { NARROW_SLOTS, type Framing, type SlotCount } from "@/lib/scene/layout";
import { Backdrop } from "./backdrop";
import { DialogueBox } from "./dialogue-box";
import type { ReadingStatus } from "./use-reading-mode";
import { SceneFigure } from "./figure";

/**
 * The scene drawn with the DOM: the backdrop, a figure per person drawn, and
 * the dialogue box over them (with the reply box or caption it is given). Holds
 * no rules: who stands where, who is lit and which lines show all come from the
 * scene's state.
 */
export function DomRenderer({
  chatId,
  placeId,
  slots,
  sceneHeight,
  loading = false,
  notice,
  footer,
  reading,
  onBacklog,
}: {
  chatId: string;
  placeId: string | undefined;
  /** Five slots or one, as measured; the director has the same count. */
  slots: SlotCount;
  /** The scene's height in px, when measured: the figures' one scale. */
  sceneHeight: number | undefined;
  /** The huddle's history is still being read. */
  loading?: boolean;
  /** Above the dialogue panel: why nobody answers. */
  notice?: ReactNode;
  /** The dialogue panel's foot: the reply box or a read-only caption. */
  footer?: ReactNode;
  /** Reading mode: lines wait for the reader; what the panel says. */
  reading?: ReadingStatus;
  /** Opens the backlog (from an echo). */
  onBacklog?: () => void;
}) {
  const figures = useSceneFigures(chatId);
  const lit = useSceneLit(chatId);
  // An upright phone shows one, from the chest up.
  const framing: Framing = slots === NARROW_SLOTS ? "bust" : "full";
  return (
    <>
      <Backdrop placeId={placeId} />
      <div className="absolute inset-0 overflow-hidden">
        {figures.map((figure) => (
          // By id: a figure keeps its element as it slides to a new column,
          // and one leaving and one taking its place are two elements.
          <SceneFigure
            key={figure.id}
            chatId={chatId}
            figure={figure}
            // The panel's speaker lit, the rest dimmed; nobody dimmed when the
            // panel's line is not a drawn person's.
            lit={lit === undefined ? undefined : figure.id === lit}
            slots={slots}
            sceneHeight={sceneHeight}
            framing={framing}
          />
        ))}
      </div>
      <DialogueBox
        chatId={chatId}
        loading={loading}
        notice={notice}
        footer={footer}
        reading={reading}
        onBacklog={onBacklog}
      />
    </>
  );
}
