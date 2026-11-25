import type { ChatMessage } from "@kazusa/client";
import type { BrainActivity } from "../brain/activity";
import { isSameDay } from "../../format";
import type { PendingMessage } from "./types";

/*
 * Runs of one sender's messages, as a transcript groups them: the live chat
 * and the screenshot it makes.
 */

const RUN_GAP_MS = 5 * 60 * 1000;

export type DisplayMessage =
  (ChatMessage & { status?: never }) | PendingMessage;

export type Run = {
  key: string;
  /** Actions are narrated, never bubbled, so they never share a run with speech. */
  isAction: boolean;
  senderId: string;
  senderName: string;
  messages: DisplayMessage[];
  dayLabel: string | null;
  /** Right after the same sender's action, which already named them. */
  introduced: boolean;
};

export function buildRuns(
  messages: DisplayMessage[],
  /** What a day's first message is headed with. */
  dayLabel: (timestamp: number) => string,
  /** Messages with something shown just before them start a new run. */
  startsRun: ReadonlyMap<number, BrainActivity>,
) {
  const runs: Run[] = [];
  let previous: DisplayMessage | null = null;

  for (const message of messages) {
    const isAction = message.type === "action";
    const newDay =
      !previous || !isSameDay(previous.timestamp, message.timestamp);
    const current = runs[runs.length - 1];
    const continues =
      current &&
      !newDay &&
      previous &&
      current.isAction === isAction &&
      previous.senderId === message.senderId &&
      message.timestamp - previous.timestamp < RUN_GAP_MS &&
      !previous.status === !message.status &&
      !("sequence" in message && startsRun.has(message.sequence));

    if (continues) {
      current.messages.push(message);
    } else {
      runs.push({
        key: message.id,
        isAction,
        senderId: message.senderId,
        senderName: message.senderName,
        messages: [message],
        dayLabel: newDay ? dayLabel(message.timestamp) : null,
        introduced:
          !newDay &&
          Boolean(current?.isAction) &&
          current?.senderId === message.senderId,
      });
    }
    previous = message;
  }
  return runs;
}
