import type { MessagesResponse } from "@kazusa/client";
import type { KazusaConfig } from "@/lib/state/config-store";

type MessagesPageKey = readonly [string, string, string, number | null];

export function messagesKeyGetter(
  config: Pick<KazusaConfig, "userId">,
  chatId: string | null,
  route = "kazusa/messages",
) {
  return (
    index: number,
    previous: MessagesResponse | null,
  ): MessagesPageKey | null => {
    if (!chatId) return null;
    if (index === 0) {
      return [route, config.userId, chatId, null];
    }
    if (!previous?.hasMore || previous.nextCursor === undefined) return null;
    const before = previous.nextCursor;
    return [route, config.userId, chatId, before];
  };
}
