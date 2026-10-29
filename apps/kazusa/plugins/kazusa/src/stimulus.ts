import { createHash } from "node:crypto";
import { z } from "zod";

export const STIMULUS = z.object({
  id: z.string().min(1).max(256),
  sessionKey: z
    .string()
    .regex(
      /^agent:[a-z0-9][a-z0-9_-]*:(tasks|chat:(direct|group|huddle):(?:user:)?[a-z0-9][a-z0-9_-]*)$/,
    ),
  sender: z.string().min(1).max(256),
  /** The sender's name as the producer knows it, shown beside their id. */
  senderName: z.string().min(1).max(256).optional(),
  text: z.string().min(1).max(32_000),
  timestamp: z.number().int().min(0).max(8_640_000_000_000_000),
  deadline: z
    .object({ taskId: z.string(), endAt: z.iso.datetime() })
    .optional(),
  idle: z.boolean().optional(),
  /**
   * Submitted ahead of its `timestamp` (a crossing foreseen when a trip was
   * planned). Held until then, and kept only if its producer confirms it still
   * happens.
   */
  foreseen: z.boolean().optional(),
});

/** Producer-owned identity and original simulation occurrence time. */
export type Stimulus = z.infer<typeof STIMULUS>;

export function stimulusKey(item: Pick<Stimulus, "sessionKey" | "id">): string {
  return createHash("sha256")
    .update(JSON.stringify([item.sessionKey, item.id]))
    .digest("hex");
}
