import type { MessagesResponse } from "@kazusa/client";

type MessagesPageKey = readonly [string, string, number | null];

export function messagesKeyGetter(
  chatId: string | null,
  route = "kazusa/messages",
) {
  return (
    index: number,
    previous: MessagesResponse | null,
  ): MessagesPageKey | null => {
    if (!chatId) return null;
    if (index === 0) {
      return [route, chatId, null];
    }
    if (!previous?.hasMore || previous.nextCursor === undefined) return null;
    const before = previous.nextCursor;
    return [route, chatId, before];
  };
}
