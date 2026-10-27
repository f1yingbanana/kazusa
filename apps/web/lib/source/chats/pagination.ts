import type { MessagesResponse } from "@kazusa/client";
import type { KazusaConfig } from "@/lib/state/config-store";

type MessagesPageKey = readonly [
  "kazusa/messages",
  string,
  string,
  string,
  number | null,
];

export function messagesKeyGetter(
  config: Pick<KazusaConfig, "baseUrl" | "userId" | "userName">,
  chatId: string | null,
) {
  return (
    index: number,
    previous: MessagesResponse | null,
  ): MessagesPageKey | null => {
    if (!chatId) return null;
    if (index === 0) {
      return ["kazusa/messages", config.baseUrl, config.userId, chatId, null];
    }
    if (!previous?.hasMore || previous.nextCursor === undefined) return null;
    const before = previous.nextCursor;
    return ["kazusa/messages", config.baseUrl, config.userId, chatId, before];
  };
}
