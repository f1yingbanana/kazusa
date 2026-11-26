"use client";

import { MapIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAccess } from "@/hooks/use-access";
import { useChatActions, useChats } from "@/hooks/use-chats";
import { usePlaces, usePlayer } from "@/hooks/use-location";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSelfIn } from "@/hooks/use-self";
import { setActiveChat } from "@/lib/live/realtime-state";
import { useLiveStore } from "@/lib/live/state";
import { chatSubject } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { setDraftChat, useDraftChat } from "@/lib/state/chat-draft";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { keepsLinkedSelection, markQuietSelection } from "@/lib/state/ui-store";
import { cx } from "@/ui/cx";
import { conversationParsers } from "../chats/open";
import {
  PLACE_PREFIX,
  usePlacesAvailable,
  useWorldNow,
  worldParsers,
} from "./world-state";
import { WorldMap } from "./map/world-map";
import { takeTalkOrigin } from "./talk-origin";
import { OwnTalk, WatchedTalk } from "./talk-view";
import { useTalk } from "./talks";

const SETTLE =
  "[&_[data-backdrop]>img:last-child]:motion-safe:animate-ui-settle";

/**
 * The world now: everyone onstage on the map. A talk held face to face opens
 * over it (`world.talk`), opening out of where it was picked like a circle
 * widening and closing back there on the way out; the map stays put beneath,
 * where you left it.
 */
export function WorldStage() {
  const [params, setParams] = useQueryStates({
    ...conversationParsers,
    "world.in": worldParsers["world.in"],
  });
  const { onstage, places } = useWorldNow();
  const available = usePlacesAvailable();
  const focus = params["world.in"];
  const focusPlaceId = focus?.startsWith(PLACE_PREFIX)
    ? focus.slice(PLACE_PREFIX.length)
    : undefined;
  const talkId = params["world.talk"];
  const phone = useMediaQuery("(max-width: 767px)");
  // A talk already open when World mounts (back from another tab, a reload, a
  // link) is simply there: only one opened while you watch widens out.
  const [openOnArrival, setOpenOnArrival] = useState(talkId);
  if (openOnArrival !== null && talkId !== openOnArrival)
    setOpenOnArrival(null);
  const { own, observed } = useTalk(talkId);
  const talk = own ?? observed;
  useTalkWith();
  useFollowTalk(talk);

  // Both name a talk, so they hold only for it: a talk closed or swapped some
  // other way (the browser's back, "On the map") leaves nothing behind.
  const [leavingId, setLeavingId] = useState<string | null>(null);
  // The talk that has finished opening over the map, which then hides.
  const [coveredBy, setCoveredBy] = useState(openOnArrival);
  if (talkId === null && (coveredBy !== null || leavingId !== null)) {
    setCoveredBy(null);
    setLeavingId(null);
  }
  const leaving = talk !== null && talk.id === leavingId;
  const shown = talk && !leaving ? talk.id : null;
  const covered = shown !== null && (phone || coveredBy === shown);
  const close = () => void setParams({ "world.talk": null, "world.as": null });
  const back = () => {
    if (
      phone ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      close();
      return;
    }
    setCoveredBy(null);
    setLeavingId(talk?.id ?? null);
  };

  const map =
    !available || !places || places.places.length === 0 ? (
      <NoMap />
    ) : (
      <WorldMap places={places} members={onstage} focusPlaceId={focusPlaceId} />
    );

  return (
    <section
      aria-label="World"
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <div
        inert={Boolean(talk)}
        className={cx("flex min-h-0 flex-1 flex-col", covered && "invisible")}
      >
        {map}
      </div>
      {talk ? (
        <TalkLayer
          key={talk.id}
          arrived={phone || talk.id === openOnArrival}
          leaving={leaving}
          onEntered={() => setCoveredBy(talk.id)}
          onLeft={() => {
            setLeavingId(null);
            close();
          }}
        >
          {own ? (
            <OwnTalk
              chat={own}
              onBack={back}
              onSent={(chat) => {
                setDraftChat(chat);
                void setParams({ "world.talk": chat.id });
              }}
            />
          ) : observed ? (
            <WatchedTalk chat={observed} onBack={back} />
          ) : null}
        </TalkLayer>
      ) : null}
    </section>
  );
}

/**
 * The talk over the map, opening out of where it was picked and closing back
 * into it.
 */
function TalkLayer({
  arrived,
  leaving,
  onEntered,
  onLeft,
  children,
}: {
  /** Open before the stage was: no entrance. */
  arrived: boolean;
  leaving: boolean;
  onEntered: () => void;
  onLeft: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  const [entering, setEntering] = useState(!arrived);
  useLayoutEffect(() => {
    const from = takeTalkOrigin();
    const rect = ref.current?.getBoundingClientRect();
    if (from && rect)
      setOrigin(
        `${Math.round(from.x - rect.left)}px ${Math.round(from.y - rect.top)}px`,
      );
  }, []);
  const style = origin ? ({ "--ui-from": origin } as CSSProperties) : undefined;

  return (
    <div
      ref={ref}
      style={style}
      className={cx(
        "absolute inset-0 z-10 flex flex-col bg-ui-surface",
        leaving
          ? "motion-safe:animate-ui-iris-out"
          : !arrived && "motion-safe:animate-ui-iris-in",
        entering && SETTLE,
      )}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (leaving) onLeft();
        else {
          setEntering(false);
          onEntered();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Opening a talk points the details panel at it, and marks it read. */
function useFollowTalk(talk: ChatInfo | null) {
  const selfOf = useSelfIn();
  const [params, setParams] = useQueryStates(conversationParsers);
  useEffect(() => {
    setActiveChat(talk?.id ?? null);
    return () => setActiveChat(null);
  }, [talk?.id]);
  const subject = talk ? chatSubject(talk, selfOf(talk)) : null;
  const key = subject ? serializeEntityRef(subject) : null;
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!key || followed.current === key) return;
    followed.current = key;
    if (params.sel && serializeEntityRef(params.sel) === key) return;
    if (keepsLinkedSelection("world.talk")) return;
    markQuietSelection(key);
    void setParams({ sel: subject }, { history: "replace" });
    // `sel` is read, not followed: picking someone else afterwards sticks.
  }, [key, setParams]);
}

/**
 * `world.with`: talk with someone standing where you are. The talk you're
 * already in with them there, or a new one whose first line, said aloud, brings
 * them (and whoever they're talking with) into it.
 */
function useTalkWith() {
  const [params, setParams] = useQueryStates(conversationParsers);
  const target = params["world.with"];
  const { chats } = useChats();
  const { createChat } = useChatActions();
  const { canPlay, isLoading } = useAccess();
  const position = usePlayer();
  const places = usePlaces();
  const draft = useDraftChat();
  const handled = useRef<string | null>(null);
  // Where you stand decides which talk is yours there: wait until it's known.
  const located = useLiveStore((state) => state.locations.size > 0);
  const ready = !position.live || (places !== null && located);

  useEffect(() => {
    if (draft && !draft.draft && chats.some((chat) => chat.id === draft.id))
      setDraftChat(null);
  }, [chats, draft]);

  useEffect(() => {
    if (!target) {
      handled.current = null;
      return;
    }
    if (isLoading || !ready || handled.current === target) return;
    handled.current = target;
    const existing = chats.find(
      (chat) =>
        chat.type === "huddle" &&
        chat.placeId === position.placeId &&
        chat.members.includes(target),
    );
    if (existing) {
      void setParams(
        { "world.talk": existing.id, "world.with": null },
        { history: "replace" },
      );
      return;
    }
    if (!canPlay) {
      void setParams({ "world.with": null }, { history: "replace" });
      return;
    }
    const next = createChat({
      type: "huddle",
      name:
        (position.placeId && places?.byId.get(position.placeId)?.name) ??
        "In person",
      members: [target],
      ...(position.placeId ? { placeId: position.placeId } : {}),
    });
    setDraftChat(next);
    void setParams(
      { "world.talk": next.id, "world.with": null },
      { history: "replace" },
    );
  }, [
    target,
    chats,
    position.placeId,
    places,
    createChat,
    setParams,
    canPlay,
    isLoading,
    ready,
  ]);
}

function NoMap() {
  return (
    <div className="grid flex-1 place-content-center justify-items-center gap-3 p-8 text-center">
      <span className="grid size-14 place-items-center rounded-[1.25rem] bg-ui-tint text-ui-primary [&_svg]:size-6">
        <MapIcon aria-hidden />
      </span>
      <h2 className="text-lg font-extrabold">No map yet</h2>
      <p className="max-w-xs text-sm text-ui-soft">
        Places added to this world appear here, with everyone onstage where they
        are.
      </p>
    </div>
  );
}
