import type { Chat as ServerChat, ChatMessage } from "@kazusa/client";

/**
 * UI View Models
 *
 * Wire DTOs and Zod schemas belong strictly in `@kazusa/client`.
 * This file defines only local, client-specific presentation state.
 */

/** A conversation in the UI. New/draft conversations stay local until their first message is sent. */
export type Chat = ServerChat & { draft?: boolean };

/** Optimistic message pending server acknowledgement and sequence numbering. */
export type PendingMessage = Omit<ChatMessage, "sequence"> & {
  status: "sending" | "failed";
};
