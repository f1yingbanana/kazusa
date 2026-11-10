import type { Conversation } from "./message-database.ts";
import type { MessageDelivery } from "./messaging.ts";

/**
 * For tests: a participant's side of a chat worked out by replaying every
 * message, as Messaging did before its database. In-memory test stores answer
 * `conversation` with it, and the database is checked against it.
 */
export function replayConversation(
  deliveries: Iterable<MessageDelivery>,
  participant: string,
  chatId: string,
  from?: number,
): Conversation {
  let lastSpokeAt: number | null = null;
  let since: MessageDelivery[] = [];
  const seen = [...deliveries]
    .filter(
      (message) =>
        message.chatId === chatId && message.audience.includes(participant),
    )
    .sort((a, b) => a.sequence - b.sequence);
  for (const message of seen)
    if (message.sender === participant) {
      lastSpokeAt = message.timestamp;
      since = [];
    } else since.push(message);
  return {
    lastSpokeAt,
    unanswered: since.length,
    waitingSince: since[0]?.timestamp ?? null,
    recent:
      from === undefined
        ? []
        : since
            .filter((message) => message.timestamp >= from)
            .map(({ id, sender, senderName, timestamp }) => ({
              id,
              sender,
              senderName,
              timestamp,
            })),
  };
}
