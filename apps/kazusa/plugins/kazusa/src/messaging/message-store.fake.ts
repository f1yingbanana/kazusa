import {
  openMessageDatabase,
  type Conversation,
  type MessageStore,
} from "./message-database.ts";
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

/**
 * For tests: the real database, in memory, mirrored into `map` so a test can
 * read what was saved. A store made from a map that already holds messages
 * starts with them, as after a restart.
 */
export function mirroredStore(
  map: Map<string, MessageDelivery>,
  now: () => number = Date.now,
): MessageStore {
  const store = openMessageDatabase({ path: ":memory:", now });
  for (const value of [...map.values()].sort((a, b) => a.sequence - b.sequence))
    void store.register(value.id, structuredClone(value));
  return {
    ...store,
    register: async (key, value, opts) => {
      await store.register(key, value, opts);
      map.set(key, structuredClone(value));
    },
  };
}
