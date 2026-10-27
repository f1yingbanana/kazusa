"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import { eventsUrl } from "@/lib/kazusa/api";
import { useKazusaConfig } from "@/lib/kazusa/config-store";
import {
  parseChatStreamEvent,
  type ChatsResponse,
  type MessageStreamEvent,
  type MessagesResponse,
  type TypingStreamEvent,
  type ChatStreamEvent,
} from "@kazusa/client";
import {
  appendMessageToPages,
  chatsKey,
  messagesCacheKey,
  updateChatPreview,
} from "@/hooks/use-kazusa";

export type ConnectionStatus = "connecting" | "open" | "error";

export type Typist = {
  senderId: string;
  senderName: string;
  expiresAt?: number;
};

type RealtimeContextValue = {
  status: ConnectionStatus;
  typingByChat: Record<string, Typist[]>;
  unreadByChat: Record<string, number>;
  setActiveChat: (chatId: string | null) => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function parseEvent(raw: string): ChatStreamEvent | null {
  return parseChatStreamEvent(raw);
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const config = useKazusaConfig();
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [typingByChat, setTypingByChat] = useState<Record<string, Typist[]>>(
    {},
  );
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>({});
  const activeChatRef = useRef<string | null>(null);

  const setActiveChat = useCallback((chatId: string | null) => {
    activeChatRef.current = chatId;
    if (chatId) {
      setUnreadByChat((current) => {
        if (!current[chatId]) return current;
        const next = { ...current };
        delete next[chatId];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const { baseUrl, userId, token } = config;
    let source: EventSource;
    try {
      source = new EventSource(eventsUrl(baseUrl, token));
    } catch {
      setStatus("error");
      return;
    }
    setStatus("connecting");
    const seenMessages = new Set<string>();
    setTypingByChat({});

    const clearTypist = (chatId: string, senderId: string) => {
      setTypingByChat((current) => {
        const list = current[chatId];
        if (!list?.some((t) => t.senderId === senderId)) return current;
        return {
          ...current,
          [chatId]: list.filter((t) => t.senderId !== senderId),
        };
      });
    };

    const handleMessage = (event: MessageStreamEvent) => {
      const { chatId, message } = event;
      if (seenMessages.has(message.id)) return;
      seenMessages.add(message.id);
      if (seenMessages.size > 1000) {
        const oldest = seenMessages.values().next().value;
        if (oldest !== undefined) seenMessages.delete(oldest);
      }
      clearTypist(chatId, message.senderId);

      void mutate(
        messagesCacheKey(config, chatId),
        (pages?: MessagesResponse[]) => appendMessageToPages(pages, message),
        { revalidate: false },
      );

      let knownChat = true;
      void mutate(
        chatsKey(config),
        (current?: ChatsResponse) => {
          if (current && !current.chats.some((chat) => chat.id === chatId)) {
            knownChat = false;
          }
          return updateChatPreview(current, chatId, message);
        },
        { revalidate: false },
      ).then(() => {
        if (!knownChat) void mutate(chatsKey(config));
      });

      if (message.senderId !== userId && activeChatRef.current !== chatId) {
        setUnreadByChat((current) => ({
          ...current,
          [chatId]: (current[chatId] ?? 0) + 1,
        }));
      }
    };

    const handleTyping = (event: TypingStreamEvent) => {
      if (event.senderId === userId) return;
      if (!event.isTyping) {
        clearTypist(event.chatId, event.senderId);
        return;
      }
      setTypingByChat((current) => {
        const list = (current[event.chatId] ?? []).filter(
          (t) => t.senderId !== event.senderId,
        );
        return {
          ...current,
          [event.chatId]: [
            ...list,
            {
              senderId: event.senderId,
              senderName: event.senderName,
              expiresAt: event.expiresAt,
            },
          ],
        };
      });
    };

    const onEvent = (raw: MessageEvent<string>) => {
      const data = parseEvent(raw.data);
      if (!data) return;
      switch (data.type) {
        case "message":
          handleMessage(data);
          break;
        case "typing":
          handleTyping(data);
          break;
        case "chats":
          void mutate<ChatsResponse>(chatsKey(config)).then((current) => {
            if (!current) return;
            setTypingByChat((typing) =>
              Object.fromEntries(
                current.chats.map((chat) => [
                  chat.id,
                  (typing[chat.id] ?? []).filter((person) =>
                    chat.members.includes(person.senderId),
                  ),
                ]),
              ),
            );
          });
          break;
        case "connected":
          setTypingByChat({});
          for (const typing of data.typing) handleTyping(typing);
          // Always refresh: messages can arrive between the initial GET and SSE.
          void mutate<ChatsResponse>(chatsKey(config)).then((current) => {
            for (const chat of current?.chats ?? [])
              void mutate(messagesCacheKey(config, chat.id));
          });
          break;
      }
    };

    source.onopen = () => {
      setStatus("open");
    };
    source.onerror = () => {
      setTypingByChat({});
      setStatus(
        source.readyState === EventSource.CLOSED ? "error" : "connecting",
      );
    };
    source.addEventListener("message", onEvent);
    source.addEventListener("typing", onEvent);
    source.addEventListener("connected", onEvent);
    source.addEventListener("chats", onEvent);

    return () => {
      source.removeEventListener("message", onEvent);
      source.removeEventListener("typing", onEvent);
      source.removeEventListener("connected", onEvent);
      source.removeEventListener("chats", onEvent);
      source.close();
    };
    // config fields are listed explicitly so a new object identity does not reconnect.
  }, [config.baseUrl, config.userId, mutate]);

  const hasTypists = Object.values(typingByChat).some(
    (list) => list.length > 0,
  );

  useEffect(() => {
    if (!hasTypists) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTypingByChat((current) => {
        let changed = false;
        const next: Record<string, Typist[]> = {};
        for (const [chatId, list] of Object.entries(current)) {
          const alive = list.filter(
            (t) => t.expiresAt === undefined || t.expiresAt > now,
          );
          if (alive.length !== list.length) changed = true;
          if (alive.length) next[chatId] = alive;
        }
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasTypists]);

  const value = useMemo(
    () => ({ status, typingByChat, unreadByChat, setActiveChat }),
    [status, typingByChat, unreadByChat, setActiveChat],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context)
    throw new Error("useRealtime must be used within RealtimeProvider");
  return context;
}
