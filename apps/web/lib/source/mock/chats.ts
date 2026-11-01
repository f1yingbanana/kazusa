import type {
  ChatMessage,
  JournalEventOf,
  MessagesResponse,
  ObservedChatsResponse,
} from "@kazusa/client";
import type { MockWorld } from "./world";

type MessageEvent = JournalEventOf<"message.sent">;

function isMessage(event: MockWorld["journal"][number]): event is MessageEvent {
  return event.kind === "message.sent";
}

/** The journal's `seq` is the mock's acceptance order. */
function toMessage(world: MockWorld, event: MessageEvent): ChatMessage {
  const { messageId, senderId, preview } = event.payload;
  return {
    id: messageId,
    requestId: messageId,
    sequence: event.seq,
    senderId,
    senderName:
      world.characters.find((character) => character.id === senderId)?.name ??
      senderId,
    text: preview,
    timestamp: event.simTime,
  };
}

/** Mock of `GET /kazusa/observe/chats`: the world's chats, from its journal. */
export function mockObservedChats(world: MockWorld): ObservedChatsResponse {
  const latest = new Map<string, MessageEvent>();
  for (const event of world.journal) {
    if (isMessage(event) && event.chatId) latest.set(event.chatId, event);
  }
  return {
    chats: world.chats.map((chat) => {
      const last = latest.get(chat.id);
      return {
        id: chat.id,
        type: chat.type,
        name: chat.title,
        members: chat.members,
        ...(last
          ? {
              lastMessage: {
                text: last.payload.preview,
                timestamp: last.simTime,
                sequence: last.seq,
                senderId: last.payload.senderId,
              },
            }
          : {}),
      };
    }),
  };
}

/** Mock of `GET /kazusa/observe/messages`, paged by sequence like the server. */
export function mockObservedMessages(
  world: MockWorld,
  params: { chatId: string; before?: number | null; limit: number },
): MessagesResponse {
  const eligible = world.journal
    .filter(isMessage)
    .filter(
      (event) =>
        event.chatId === params.chatId &&
        (params.before == null || event.seq < params.before),
    );
  const page = eligible.slice(-params.limit);
  const hasMore = eligible.length > page.length;
  return {
    messages: page.map((event) => toMessage(world, event)),
    hasMore,
    ...(hasMore ? { nextCursor: page[0].seq } : {}),
  };
}
