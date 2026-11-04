import { personLabel } from "../person-label.ts";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
dayjs.extend(utc);

/**
 * Format a simulation timestamp as UTC `ddd YYYY-MM-DD HH:mm` (e.g. `Fri
 * 2026-10-23 08:00`). Dropping seconds, 'T', and 'Z' saves significant token
 * budget across large histories.
 */
export function formatSimTime(timestamp: number): string {
  return dayjs.utc(timestamp).format("ddd YYYY-MM-DD HH:mm");
}

/**
 * Strips internal prefix `agent:<agentId>:` to yield clean stream headers (e.g.
 * `tasks`, `chat:direct:bob`).
 */
export function formatSessionHeader(sessionKey: string): string {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[0] === "agent") {
    return parts.slice(2).join(":");
  }
  return sessionKey;
}

/**
 * One record for the decision model: `[<speaker> <sim time>] <text>`, each
 * person by id. A character's own records are worded by their skills
 * (`renderLedgerRecords`).
 */
export function formatEnvelopeRecord(params: {
  sessionKey: string;
  message: SessionCatalogTranscriptItem;
  timestamp: number;
}): string {
  const time = formatSimTime(params.timestamp);
  const text = params.message.text?.trim() ?? "";

  const stream = formatSessionHeader(params.sessionKey);
  if (stream === "tasks") {
    return `\n\n[${time}] ${text}`;
  }

  // The catalog projects __openclaw.senderIdentity into sender.identity.
  // Roles, dialogue, display names and peer keys are never author evidence.
  const sender = params.message.sender?.identity.id;
  const owner = params.sessionKey.split(":")[1];
  let speaker = "unknown";
  if (sender)
    speaker = sender === owner ? "(self)" : personLabel(undefined, sender);
  return `\n\n[${speaker} ${time}] ${text}`;
}
