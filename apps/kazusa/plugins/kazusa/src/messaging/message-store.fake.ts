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
  const read =
    from === undefined
      ? undefined
      : since
          .filter(
            (message) =>
              message.timestamp >= from &&
              // Read unless their copy says otherwise, as `unread` rows do.
              !message.copies.some(
                (copy) =>
                  copy.agentId === participant &&
                  copy.role === "user" &&
                  copy.readAt === undefined,
              ),
          )
          .at(-1);
  return {
    lastSpokeAt,
    unanswered: since.length,
    waitingSince: since[0]?.timestamp ?? null,
    ...(read
      ? {
          lastRead: {
            id: read.id,
            sender: read.sender,
            senderName: read.senderName,
            timestamp: read.timestamp,
          },
        }
      : {}),
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
    // The database first: a refused write leaves the map as it was.
    register: async (key, value, opts) => {
      await store.register(key, value, opts);
      map.set(key, structuredClone(value));
    },
  };
}
