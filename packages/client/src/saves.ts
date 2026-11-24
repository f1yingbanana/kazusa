/**
 * A world's saves, as the frontend's `/saves` route and the plugin's
 * `src/world/saves.ts` share them: a save is a commit on `refs/saves/*`, and a
 * save or load runs while `scripts/dev.mjs` has the Gateway stopped.
 */

export type SaveKind = "save" | "autosave";

export interface GameSave {
  readonly ref: string;
  readonly commit: string;
  /** The creator's commit the world stood on. */
  readonly base: string;
  /** The player's name for it; null when they gave none. */
  readonly name: string | null;
  readonly kind: SaveKind;
  /** When it was made, ISO. */
  readonly savedAt: string;
  /** The world's clock then, ms; null when it couldn't be read. */
  readonly simTime: number | null;
  /** The world's release then, when it stood on one. */
  readonly version: string | null;
  /** The line of the creator's history it follows (`main`). */
  readonly branch: string | null;
  /** The Kazusa that made it (`git describe` or the installer's version). */
  readonly kazusaVersion: string | null;
}

/** What runs now, which a save made with other versions may not suit. */
export interface RunningVersions {
  readonly version: string | null;
  readonly kazusaVersion: string | null;
}

export type SavePhase =
  | "waiting"
  | "pausing"
  | "stopping"
  | "saving"
  | "loading"
  | "starting"
  | "done"
  | "failed";

/** A save or load the owner asked for, as `scripts/dev.mjs` carries it out. */
export interface SaveRequest {
  readonly id: string;
  readonly op: "save" | "load";
  /** A save's name, or that of the save being loaded; none when it has none. */
  readonly name?: string;
  /** The save being loaded, or the one made. */
  readonly ref?: string;
  /** A save's kind: the slot before an update is an autosave. */
  readonly kind?: SaveKind;
  readonly phase: SavePhase;
  readonly at: number;
  readonly error?: string;
  /** A load that worked, but kept less of this machine than it should have. */
  readonly warnings?: readonly string[];
  /** The clock's speed before it was paused for a save, to put back after. */
  readonly speed?: number;
}

export const isRunning = (request: SaveRequest | null | undefined): boolean =>
  Boolean(request && request.phase !== "done" && request.phase !== "failed");
