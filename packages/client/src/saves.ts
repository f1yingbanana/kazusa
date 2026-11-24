import { z } from "zod";

/**
 * A world's saves, as the frontend's `/saves` route and the plugin's
 * `src/world/saves.ts` share them: a save is a commit on `refs/saves/*`, and a
 * save or load runs while `scripts/dev.mjs` has the Gateway stopped.
 */

export const SaveKindSchema = z.enum(["save", "autosave"]);
export type SaveKind = z.infer<typeof SaveKindSchema>;

export const GameSaveSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  /** The creator's commit the world stood on. */
  base: z.string(),
  /** The player's name for it; null when they gave none. */
  name: z.string().nullable(),
  kind: SaveKindSchema,
  /** When it was made, ISO. */
  savedAt: z.string(),
  /** The world's clock then, ms; null when it couldn't be read. */
  simTime: z.number().nullable(),
  /** The world's release then, when it stood on one. */
  version: z.string().nullable(),
  /** The line of the creator's history it follows (`main`). */
  branch: z.string().nullable(),
  /** The Kazusa that made it (`git describe` or the installer's version). */
  kazusaVersion: z.string().nullable(),
});
export type GameSave = z.infer<typeof GameSaveSchema>;

/** What runs now, which a save made with other versions may not suit. */
export const RunningVersionsSchema = z.object({
  version: z.string().nullable(),
  kazusaVersion: z.string().nullable(),
});
export type RunningVersions = z.infer<typeof RunningVersionsSchema>;

export const SavePhaseSchema = z.enum([
  "waiting",
  "pausing",
  "stopping",
  "saving",
  "loading",
  "starting",
  "done",
  "failed",
]);
export type SavePhase = z.infer<typeof SavePhaseSchema>;

/** A save or load the owner asked for, as `scripts/dev.mjs` carries it out. */
export const SaveRequestSchema = z.object({
  id: z.string(),
  op: z.enum(["save", "load"]),
  /** A save's name, or that of the save being loaded; none when it has none. */
  name: z.string().optional(),
  /** The save being loaded, or the one made. */
  ref: z.string().optional(),
  /** A save's kind: the slot before an update is an autosave. */
  kind: SaveKindSchema.optional(),
  phase: SavePhaseSchema,
  at: z.number(),
  error: z.string().optional(),
  /** A load that worked, but kept less of this machine than it should have. */
  warnings: z.array(z.string()).optional(),
  /** The clock's speed before it was paused for a save, to put back after. */
  speed: z.number().optional(),
});
export type SaveRequest = z.infer<typeof SaveRequestSchema>;

export const isRunning = (request: SaveRequest | null | undefined): boolean =>
  Boolean(request && request.phase !== "done" && request.phase !== "failed");

/** `GET /saves`: the saves, the request under way or last, what runs now. */
export const SavesResponseSchema = z.object({
  saves: z.array(GameSaveSchema).default([]),
  request: SaveRequestSchema.nullable().default(null),
  current: RunningVersionsSchema.nullable().default(null),
  /** Whether something can restart the Gateway (`scripts/dev.mjs`). */
  supervised: z.boolean().default(false),
});
export type SavesResponse = z.infer<typeof SavesResponseSchema>;

const SaveRefSchema = z.string().startsWith("refs/saves/");

/** `POST /saves`: save (into the before-update slot, if asked), load, delete. */
export const SaveActionSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save"),
    name: z.string().max(200).optional(),
    /** Into the slot kept for before a world update, named for it. */
    beforeUpdate: z.boolean().optional(),
  }),
  z.object({ op: z.literal("load"), ref: SaveRefSchema }),
  z.object({ op: z.literal("delete"), ref: SaveRefSchema }),
]);
export type SaveAction = z.infer<typeof SaveActionSchema>;

/** `POST /saves`: the request staged, for a save or load. */
export const SaveActionResponseSchema = z.object({
  request: SaveRequestSchema.optional(),
});
