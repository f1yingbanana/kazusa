"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useSources } from "../source/provider";
import {
  applyTyping,
  clearTyping,
  clearTypist,
  clearUnread,
  expireTyping,
  receiveMessage,
  retainMembers,
  setStatus,
  useRealtimeStore,
} from "./realtime-state";
import { eventsUrl } from "@/lib/source/chats/http";
import { isDesiresKey } from "@/lib/source/desires/http";
import { isLocationsKey, isPlacesKey } from "@/lib/source/location/http";
import {
  OBSERVED_MESSAGES_KEY,
  observedChatsKey,
} from "@/lib/source/observe/http";
import {
  parseStreamEvent,
  type ObservedChatsResponse,
  type ChatsResponse,
  type MessageStreamEvent,
  type TypingStreamEvent,
} from "@kazusa/client";
import { unstable_serialize } from "swr/infinite";
import { dispatchLive } from "@/lib/registry/live";
import { fetchTimeline } from "@/lib/source/timeline/http";
import { mergeJournal, setStatuses } from "./state";
import { applySceneEvent, silenceScenes } from "./scene-state";
import {
  appendCachedMessage,
  chatsKey,
  markCachedMessagesRead,
  messagesCacheKey,
  updateChatPreview,
} from "../source/chats/cache";

/**
 * One SSE connection per scope; observer event types fan out through the live
 * registry.
 */
const OBSERVER_EVENTS = [
  "status",
  "journal",
  "clock",
  "desires",
  "location",
  "places",
  "observed",
] as const;
const PLAYER_EVENTS = [
  "message",
  "typing",
  "read",
  "connected",
  "chats",
] as const;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15_000;
/** Huddles form and dissolve often, and this list costs a read of all history. */
const OBSERVED_REFRESH_MS = 2_000;
const JOURNAL_RECENT_LIMIT = 200;
const TIMELINE_PAGES_PREFIX = unstable_serialize(() => ["kazusa/timeline"]);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { cache, mutate } = useSWRConfig();
  const { resolved, player } = useSources();
  const userId = player.id;
  const { mutate: refreshJournal } = useSWR(
    resolved.timeline === "live" ? (["kazusa/timeline/live"] as const) : null,
    () => fetchTimeline({ limit: JOURNAL_RECENT_LIMIT }),
    {
      revalidateOnFocus: false,
      onSuccess: ({ events }) => {
        mergeJournal(events);
      },
    },
  );
  const hasTypists = useRealtimeStore((state) =>
    Object.values(state.typingByChat).some((list) => list.length > 0),
  );

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelay = RETRY_MIN_MS;
    let observedRefresh: number | undefined;
    setStatus("connecting");
    clearUnread();
    const seenMessages = new Set<string>();
    clearTyping();
    silenceScenes();

    const rememberMessage = (id: string): boolean => {
      if (seenMessages.has(id)) return false;
      seenMessages.add(id);
      if (seenMessages.size > 1000) {
        const oldest = seenMessages.values().next().value;
        if (oldest !== undefined) seenMessages.delete(oldest);
      }
      return true;
    };

    const handleMessage = (event: MessageStreamEvent) => {
      const { chatId, message } = event;
      if (!rememberMessage(message.id)) return;
      clearTypist(chatId, message.senderId);
      applySceneEvent(chatId, { type: "message", message, at: Date.now() });

      void appendCachedMessage(mutate, chatId, message);

      let knownChat = true;
      void mutate(
        chatsKey(),
        (current?: ChatsResponse) => {
          knownChat =
            current?.chats.some((chat) => chat.id === chatId) ?? false;
          return updateChatPreview(current, chatId, message);
        },
        { revalidate: false },
      ).then(() => {
        if (!disposed && !knownChat) void mutate(chatsKey());
      });

      receiveMessage(chatId, message.senderId !== userId);
    };

    const refreshObserved = () => {
      observedRefresh ??= window.setTimeout(() => {
        observedRefresh = undefined;
        void mutate(observedChatsKey());
      }, OBSERVED_REFRESH_MS);
    };

    /** Someone else's chat: no unread, nothing of the player's changes. */
    const handleObservedMessage = ({ chatId, message }: MessageStreamEvent) => {
      if (!rememberMessage(message.id)) return;
      clearTypist(chatId, message.senderId);
      applySceneEvent(chatId, { type: "message", message, at: Date.now() });
      void appendCachedMessage(mutate, chatId, message, OBSERVED_MESSAGES_KEY);
      let knownChat = true;
      void mutate(
        observedChatsKey(),
        (current?: ObservedChatsResponse) => {
          knownChat =
            current?.chats.some((chat) => chat.id === chatId) ?? false;
          return updateChatPreview(current, chatId, message);
        },
        { revalidate: false },
      ).then(() => {
        if (!disposed && !knownChat) refreshObserved();
      });
    };

    const handleTyping = (event: TypingStreamEvent) => {
      if (event.senderId === userId) return;
      applyTyping(event);
      applySceneEvent(event.chatId, {
        type: "typing",
        typing: event,
        at: Date.now(),
      });
    };

    const onEvent = (raw: MessageEvent<string>) => {
      const data = parseStreamEvent(raw.data);
      if (!data) return;
      switch (data.type) {
        case "message":
          handleMessage(data);
          break;
        case "typing":
          handleTyping(data);
          break;
        case "read":
          void markCachedMessagesRead(mutate, data);
          break;
        case "chats":
          void mutate<ChatsResponse>(chatsKey()).then((current) => {
            if (disposed || !current) return;
            // Only the player's chats are checked; others' typists stay.
            retainMembers(current.chats);
          });
          break;
        case "places":
          // A new home moves whoever hasn't gone anywhere yet.
          void mutate(isPlacesKey);
          void mutate(isLocationsKey);
          break;
        case "observed":
          if (data.event.type === "message") handleObservedMessage(data.event);
          else if (data.event.type === "typing") handleTyping(data.event);
          else refreshObserved();
          break;
        case "connected": {
          clearTyping();
          silenceScenes();
          for (const typing of data.typing) handleTyping(typing);
          if (data.statuses) {
            setStatuses(Object.entries(data.statuses));
          }
          // Desire records and the map changed while disconnected are only in the
          // snapshot.
          void mutate(isDesiresKey);
          void mutate(isPlacesKey);
          void mutate(isLocationsKey);
          void mutate(observedChatsKey());
          // Refresh the recent window; durable history remains in SWR.
          void refreshJournal();
          void mutate(
            (key) => Array.isArray(key) && key[0] === "kazusa/timeline/recent",
          );
          // Invalidate individual history pages before revalidating their
          // aggregates, which otherwise reuse those pages without fetching.
          // The aggregate keeps the rendered history visible during the read.
          void mutate(
            (key) => Array.isArray(key) && key[0] === "kazusa/timeline",
            undefined,
            { revalidate: false },
          ).then(() => {
            if (disposed) return;
            for (const key of cache.keys()) {
              if (key.startsWith(TIMELINE_PAGES_PREFIX)) void mutate(key);
            }
          });
          const activeChat = useRealtimeStore.getState().activeChat;
          if (activeChat)
            void mutate(messagesCacheKey(activeChat, OBSERVED_MESSAGES_KEY));
          // Always refresh: messages can arrive between the initial GET and SSE.
          void mutate<ChatsResponse>(chatsKey()).then((current) => {
            if (disposed) return;
            for (const chat of current?.chats ?? [])
              void mutate(messagesCacheKey(chat.id));
          });
          break;
        }
        default:
          dispatchLive(data);
      }
    };

    const eventNames = [...PLAYER_EVENTS, ...OBSERVER_EVENTS];
    const disconnect = () => {
      if (!source) return;
      for (const name of eventNames) source.removeEventListener(name, onEvent);
      source.onopen = null;
      source.onerror = null;
      source.close();
      source = null;
    };
    // EventSource only retries network drops on its own. A non-SSE response
    // (e.g. the proxy's 502 while the Gateway restarts) closes it for good, so
    // reopen it ourselves with backoff.
    const connect = () => {
      if (disposed || source) return;
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      if (!navigator.onLine) {
        setStatus("error");
        return;
      }
      setStatus("connecting");
      let next: EventSource;
      try {
        next = new EventSource(eventsUrl());
      } catch {
        setStatus("error");
        return;
      }
      source = next;
      next.onopen = () => {
        retryDelay = RETRY_MIN_MS;
        setStatus("open");
      };
      next.onerror = () => {
        clearTyping();
        silenceScenes();
        if (next.readyState !== EventSource.CLOSED && navigator.onLine) {
          setStatus("connecting");
          return;
        }
        setStatus("error");
        disconnect();
        if (navigator.onLine) {
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      };
      for (const name of eventNames) next.addEventListener(name, onEvent);
    };
    const onOffline = () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      disconnect();
      clearTyping();
      silenceScenes();
      setStatus("error");
    };
    const onOnline = () => {
      retryDelay = RETRY_MIN_MS;
      connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    connect();

    return () => {
      disposed = true;
      clearTyping();
      silenceScenes();
      setStatus("connecting");
      window.clearTimeout(retryTimer);
      window.clearTimeout(observedRefresh);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      disconnect();
    };
    // Only the player changes what the stream means; a new object identity must not reconnect.
  }, [userId, cache, mutate, refreshJournal]);

  useEffect(() => {
    if (!hasTypists) return;
    const interval = window.setInterval(() => expireTyping(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasTypists]);

  return <>{children}</>;
}
