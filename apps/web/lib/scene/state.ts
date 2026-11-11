/**
 * Scene state: a huddle drawn as people in a place. Data only: no URLs, pixel
 * positions, timers or renderer kind. The time of day is read by renderers from
 * the sim clock, never stored here.
 */

/**
 * A look by its set-name parts. No outfit means usual clothes; no mood,
 * neutral.
 */
export interface Look {
  readonly outfit?: string;
  readonly mood?: string;
}

import type { SlotCount } from "./layout";

export type Presence = "entering" | "here" | "leaving";

export interface Figure {
  /** Character id. */
  readonly id: string;
  /**
   * Where they stand, 0 to `slots - 1` from the left. Figures holding a place
   * keep their left-to-right order; the director moves them only when someone
   * comes or goes (`figureColumns` in `layout.ts`), never because someone
   * speaks. A leaving figure keeps the column it walks off from.
   */
  readonly column: number;
  readonly look: Look;
  /**
   * `entering` and `leaving` last until the renderer's transition ends and it
   * sends `settle`; a leaving figure no longer holds its slot.
   */
  readonly presence: Presence;
}

export interface SceneLine {
  /** Absent while the line is still being said (later, §6.2). */
  readonly messageId?: string;
  readonly speakerId: string;
  /** As the message names them; the player's display name comes from data. */
  readonly speakerName: string;
  readonly kind: "speech" | "action";
  /** Raw text; an action is shown through `actionLine()` at render time. */
  readonly text: string;
  /** Sim-time window of the saying, when known (§6.2). */
  readonly said?: { readonly from: number; readonly until: number };
  /** Stopped mid-line: the committed text ends where it was cut ("—"). */
  readonly cutOff: boolean;
  /**
   * Wall-clock ms when it went on screen, for its minimum time there. Absent
   * for lines read from history and for lines still `ahead`.
   */
  readonly shownAt?: number;
  /**
   * Wall-clock ms when it left the panel for the echoes, when known (absent for
   * history), so an echo can fade a while after it was pushed up.
   */
  readonly leftAt?: number;
}

export interface SceneState {
  readonly chatId: string;
  readonly placeId?: string;
  /** Never drawn: the scene is seen through their eyes. */
  readonly playerId: string;
  /** Five slots or one, as the renderer measures (`slotCount`). */
  readonly slots: SlotCount;
  /**
   * Who can be drawn: the characters with portraits. `undefined` until the
   * roster has been read: nobody is drawn, and no place is kept, until then.
   * Anyone else is never a figure; their lines still show.
   */
  readonly drawable: ReadonlySet<string> | undefined;
  /** Who is in the conversation now, without the player, in wire order. */
  readonly members: readonly string[];
  /**
   * Who is saying a line now (speaking events), the player never: for the
   * one-slot scene and who gives up a place. Who is lit follows the panel's
   * line instead (`litFigure`).
   */
  readonly speakers: readonly string[];
  /** Who is drawn, leaving figures included; at most one per id. */
  readonly figures: readonly Figure[];
  /**
   * The one line in the panel, under its speaker's name: the newest said, or
   * someone's line still being said (no `messageId`, while they speak and the
   * line before it has had its time). `undefined` before anything is said.
   */
  readonly line: SceneLine | undefined;
  /**
   * What was just said: the lines that left the panel, oldest first, at most
   * `MAX_ECHOES`. Never a line still being said.
   */
  readonly echoes: readonly SceneLine[];
  /** Lines received but not shown yet: catching up, or reading mode (§7). */
  readonly ahead: readonly SceneLine[];
  /**
   * Reading mode: every new line waits in `ahead` until the reader asks for it
   * (`show-next`); nothing is shown by its turn coming.
   */
  readonly reading: boolean;
  /**
   * Reading mode: the reader asked for the next line before it came, so it is
   * shown the moment it arrives (one pending request, never more).
   */
  readonly wanted: boolean;
  /**
   * The turn each member last spoke or acted on: a counter, not a time. Whoever
   * did so longest ago gives up their place first; the one-slot scene shows
   * whoever did so last.
   */
  readonly spoke: Readonly<Record<string, number>>;
  readonly turn: number;
  /** Highest message sequence taken in; a history read adds only newer ones. */
  readonly sequence: number;
}
