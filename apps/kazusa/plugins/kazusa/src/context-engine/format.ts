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
 * One record: `[<speaker> HH:mm] <text>`. The date is on the group's header. A
 * person's id is shown the first time only, to keep long days small.
 */
export function formatEnvelopeRecord(params: {
  sessionKey: string;
  message: SessionCatalogTranscriptItem;
  timestamp: number;
  /** Trusted names by id; never the catalog's own label. */
  names?: ReadonlyMap<string, string>;
  /**
   * People already introduced by id in this block; updated here. Blocks with a
   * dated header pass it, and times shorten to the hour and minute.
   */
  named?: Set<string>;
}): string {
  const time = params.named
    ? dayjs.utc(params.timestamp).format("HH:mm")
    : formatSimTime(params.timestamp);
  const text = params.message.text?.trim() ?? "";

  const stream = formatSessionHeader(params.sessionKey);
  if (stream === "tasks") {
    return `\n\n[${time}] ${text}`;
  }

  // The catalog projects __openclaw.senderIdentity into sender.identity.
  // Roles, dialogue, display names and peer keys are never author evidence.
  const sender = params.message.sender?.identity.id;
  const owner = params.sessionKey.split(":")[1];
  // The id attributes; the name beside it is only to read, and comes from the
  // character's own identity, never the catalog's label.
  let speaker = "unknown";
  if (sender) {
    const name = params.names?.get(sender);
    if (sender === owner) speaker = params.named ? "you" : "(self)";
    else if (name && params.named?.has(sender)) speaker = name;
    else {
      speaker = personLabel(name, sender);
      params.named?.add(sender);
    }
  }
  return `\n\n[${speaker} ${time}] ${text}`;
}
