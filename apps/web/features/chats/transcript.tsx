"use client";

import type { ChatMessage } from "@kazusa/client";
import { CopyIcon, CropIcon, SparklesIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useLongPress } from "@/hooks/use-long-press";
import type { useParticipantResolver } from "@/hooks/use-participants";
import { useSelection } from "@/hooks/use-selection";
import { formatDayLabel, formatTime } from "@/lib/format";
import type { Typist } from "@/lib/live/realtime-state";
import type { BrainActivity } from "@/lib/source/brain/activity";
import {
  actionLine,
  isOneOnOne,
  messageReceipt,
  receiptLabel,
} from "@/lib/source/chats/display";
import { buildRuns, type DisplayMessage } from "@/lib/source/chats/runs";
import {
  includedIn,
  pickMessage,
  type ShotRange,
} from "@/lib/source/chats/screenshot";
import type { ChatInfo, PendingMessage } from "@/lib/source/chats/types";
import { requestInspector } from "@/lib/state/ui-store";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { LineActions, type LineAction } from "@/ui/line-actions";
import {
  Bubble,
  DayMark,
  MessageFoot,
  MessageRun,
  MessagesLoading,
  Narration,
  Receipt,
  type RunPosition,
  Sticker,
  TypingBubble,
} from "@/ui/message";
import { Note } from "@/ui/note";
import { ScrollLog } from "@/ui/scroll-log";
import { CharacterAvatar } from "../characters/character-avatar";
import { BrainActivityRows, BrainThinking } from "./brain-activity";
import { ScreenshotDialog } from "./screenshot/dialog";
import {
  ScreenshotBar,
  ScreenshotFrame,
  ScreenshotReach,
} from "./screenshot/frame";

type Resolve = ReturnType<typeof useParticipantResolver>;

const EMPTY = {
  direct: {
    title: (name: string) => `Say hello to ${name}`,
    body: "Messages here are private between you and them.",
  },
  group: {
    title: (name: string) => `Welcome to ${name}`,
    body: "Everyone in this group sees your message and can reply.",
  },
  huddle: {
    title: () => "Nobody has spoken yet",
    body: "You're face to face: everyone here can hear you.",
  },
} as const;
const EMPTY_OBSERVED = {
  title: () => "Nothing said yet",
  body: "Messages appear here as they're sent.",
};

/**
 * A conversation as lines: each sender's run of bubbles under their name, what
 * they did told in italics, days marked, someone typing as dots. Lines that
 * arrive while it's open rise into place; the history it opened on doesn't
 * move. Copy and Screenshot sit beside each sent line.
 */
export function Transcript({
  chat,
  observed = false,
  messages,
  pending = [],
  typists,
  isLoading,
  error,
  hasMore,
  isLoadingOlder,
  onLoadOlder,
  onRetry,
  resolve,
  userId,
  activity = [],
  activityRunning = false,
  after,
  className,
}: {
  chat: ChatInfo;
  observed?: boolean;
  messages: readonly ChatMessage[];
  pending?: readonly PendingMessage[];
  typists: readonly Typist[];
  isLoading: boolean;
  error?: Error;
  hasMore: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry?: (message: PendingMessage) => void;
  resolve: Resolve;
  userId: string;
  /** The system admin's model calls, placed among its messages. */
  activity?: readonly BrainActivity[];
  activityRunning?: boolean;
  /** At the end of the conversation, after the last line. */
  after?: ReactNode;
  className?: string;
}) {
  const simNow = useSimNow();
  const group = !isOneOnOne(chat, userId);
  const inPerson = chat.type === "huddle";
  const before = useMemo(
    () =>
      new Map(
        activity.flatMap((a) =>
          a.beforeSequence === undefined
            ? []
            : [[a.beforeSequence, a] as const],
        ),
      ),
    [activity],
  );
  const trailing = activity.filter((a) => a.beforeSequence === undefined);
  const runs = buildRuns(
    [...messages, ...pending],
    (timestamp) => formatDayLabel(timestamp, simNow),
    before,
  );
  const pendingById = new Map(pending.map((m) => [m.id, m]));
  const fresh = useArrivals(messages, isLoading, userId);
  const shot = useScreenshot(chat.id, messages);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const press = useLongPress(setMenuFor);
  const nameOf = (id: string) => resolve(id).name;

  const actionsFor = (message: DisplayMessage): ReactNode => {
    if (shot.range || pendingById.has(message.id)) return null;
    const actions: LineAction[] = [
      {
        label: "Copy text",
        icon: <CopyIcon aria-hidden />,
        run: () =>
          void navigator.clipboard.writeText(message.text).then(
            () => toast.success("Copied"),
            () =>
              toast.error("Couldn't copy: the browser blocked the clipboard."),
          ),
      },
      {
        label: "Screenshot",
        icon: <CropIcon aria-hidden />,
        run: () => shot.start(message.id),
      },
    ];
    return (
      <LineActions
        actions={actions}
        open={menuFor === message.id}
        onClose={() => setMenuFor(null)}
      />
    );
  };
  /** A sent line: held on touch for its actions, picked while framing a shot. */
  const lineProps = (message: DisplayMessage) =>
    pendingById.has(message.id)
      ? {}
      : {
          ...shot.rowProps(message.id),
          ...press(message.id),
          className:
            "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
        };
  const empty = observed ? EMPTY_OBSERVED : EMPTY[chat.type];

  return (
    <>
      <ScrollLog
        key={chat.id}
        label={`Messages in ${chat.name}`}
        className={className}
        contentClassName="mx-auto w-full max-w-3xl gap-3 px-4 pt-6 pb-6 motion-safe:animate-ui-thread-in"
        overlay={
          shot.range ? (
            <>
              <ScreenshotReach
                ids={shot.ids}
                range={shot.range}
                onChange={shot.select}
              />
              <ScreenshotBar
                count={shot.chosen.length}
                onCancel={shot.stop}
                onCreate={() => shot.setExporting(true)}
              />
            </>
          ) : undefined
        }
      >
        <div
          className={
            shot.range
              ? "relative flex flex-1 flex-col gap-3 select-none **:data-shot-id:cursor-pointer [&_[data-shot-in]:focus-visible]:outline-2 [&_[data-shot-in]:focus-visible]:outline-offset-4 [&_[data-shot-in]:focus-visible]:outline-ui-primary"
              : "relative flex flex-1 flex-col gap-3"
          }
          onClickCapture={shot.onClickCapture}
        >
          {shot.range ? (
            <ScreenshotFrame
              ids={shot.ids}
              range={shot.range}
              excluded={shot.excluded}
              onChange={shot.select}
            />
          ) : null}
          {hasMore ? (
            <div className="flex justify-center">
              <Button
                tone="ghost"
                size="sm"
                disabled={isLoadingOlder}
                onClick={onLoadOlder}
              >
                {isLoadingOlder ? "Loading…" : "Load earlier messages"}
              </Button>
            </div>
          ) : null}
          {isLoading ? <MessagesLoading /> : null}
          {error && !isLoading ? <Note>{error.message}</Note> : null}
          {!isLoading && !error && runs.length === 0 && !after ? (
            <div className="m-auto flex max-w-80 flex-col items-center gap-2 py-10 text-center">
              <span className="grid size-12 place-items-center rounded-[1rem] bg-ui-tint text-ui-primary motion-safe:animate-ui-bob [&_svg]:size-5">
                <SparklesIcon aria-hidden />
              </span>
              <p className="text-[0.9375rem] font-extrabold">
                {empty.title(chat.name)}
              </p>
              <p className="text-[0.8125rem] text-pretty text-ui-soft">
                {empty.body}
              </p>
            </div>
          ) : null}

          {runs.map((run) => {
            const sender = resolve(run.senderId, run.senderName);
            const mine = run.senderId === userId;
            const side = mine ? "end" : "start";
            const first = run.messages[0];
            const work =
              first && "sequence" in first
                ? before.get(first.sequence)
                : undefined;
            const last = run.messages.at(-1);
            return (
              <Fragment key={run.key}>
                {work ? (
                  <BrainActivityRows activity={work} running={false} />
                ) : null}
                {run.dayLabel ? <DayMark>{run.dayLabel}</DayMark> : null}
                <MessageRun
                  side={side}
                  face={
                    mine || run.isAction ? undefined : (
                      <SenderFace sender={sender} />
                    )
                  }
                  name={
                    group && !mine && !run.isAction && !run.introduced
                      ? sender.name
                      : undefined
                  }
                >
                  {run.messages.map((message, index) => {
                    const pend = pendingById.get(message.id);
                    const enter = fresh(message);
                    const key = message.requestId ?? message.id;
                    if (run.isAction) {
                      const line = actionLine(sender.name, message.text);
                      return (
                        <Narration
                          key={key}
                          side={side}
                          subject={line.subject}
                          rest={line.rest}
                          title={formatTime(message.timestamp)}
                          failed={pend?.status === "failed"}
                          sending={pend?.status === "sending"}
                          enter={enter}
                          actions={actionsFor(message)}
                          {...lineProps(message)}
                        />
                      );
                    }
                    if (message.type === "sticker" && message.sticker) {
                      return (
                        <Sticker
                          key={key}
                          side={side}
                          src={message.sticker.url}
                          alt={message.text}
                          enter={enter}
                          actions={actionsFor(message)}
                          {...lineProps(message)}
                        />
                      );
                    }
                    return (
                      <Bubble
                        key={key}
                        side={side}
                        tone={
                          pend?.status === "failed"
                            ? "failed"
                            : mine
                              ? "mine"
                              : "theirs"
                        }
                        position={positionOf(index, run.messages.length)}
                        sending={pend?.status === "sending"}
                        enter={enter}
                        actions={actionsFor(message)}
                        {...lineProps(message)}
                      >
                        {message.text}
                      </Bubble>
                    );
                  })}
                  {/* Something done is timed on hover; only your own says it landed. */}
                  {last && (!run.isAction || mine) ? (
                    <MessageFoot>
                      <Status
                        message={last}
                        pending={pendingById.get(last.id)}
                        onRetry={onRetry}
                        nameOf={mine ? nameOf : undefined}
                        inPerson={inPerson}
                      />
                    </MessageFoot>
                  ) : null}
                </MessageRun>
              </Fragment>
            );
          })}

          {trailing.map((a) => (
            <BrainActivityRows
              key={a.key}
              activity={a}
              running={activityRunning}
            />
          ))}
          {activityRunning ? <BrainThinking /> : null}

          {typists.map((typist) => {
            const sender = resolve(typist.senderId, typist.senderName);
            return (
              <MessageRun
                key={`typing-${typist.senderId}`}
                side="start"
                face={<SenderFace sender={sender} />}
                name={group ? sender.name : undefined}
              >
                <TypingBubble
                  label={
                    typist.mode === "speaking"
                      ? `${sender.name} is speaking`
                      : `${sender.name} is typing`
                  }
                />
                <MessageFoot>{null}</MessageFoot>
              </MessageRun>
            );
          })}
          {after}
        </div>
      </ScrollLog>
      <ScreenshotDialog
        open={Boolean(shot.range) && shot.exporting}
        onOpenChange={shot.setExporting}
        onDone={shot.stop}
        chat={chat}
        messages={shot.chosen}
        userId={userId}
        resolve={resolve}
      />
    </>
  );
}

function positionOf(index: number, count: number): RunPosition {
  if (count === 1) return "single";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/**
 * Which lines arrived while the conversation was open, and so rise into place:
 * your own as you send them, and anyone else's newer than the newest it opened
 * on. The server's copy of your own line doesn't rise again.
 */
function useArrivals(
  messages: readonly ChatMessage[],
  loading: boolean,
  self: string,
) {
  const opened = useRef<number | null>(null);
  if (opened.current === null && !loading)
    opened.current = messages.at(-1)?.sequence ?? -1;
  const after = opened.current;
  return (message: DisplayMessage) => {
    if (after === null) return false;
    if (message.status) return true;
    return (
      "sequence" in message &&
      message.sequence > after &&
      message.senderId !== self
    );
  };
}

/**
 * A crop over the sent messages, kept by id so it survives older pages loading
 * above it and belongs to the chat it was made in.
 */
function useScreenshot(chatId: string, messages: readonly ChatMessage[]) {
  const [shot, setShot] = useState<{
    chatId: string;
    startId: string;
    endId: string;
  } | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const ids = useMemo(() => messages.map((m) => m.id), [messages]);
  const indexById = useMemo(
    () => new Map(ids.map((id, index) => [id, index])),
    [ids],
  );
  const indexOf = (id: string) => indexById.get(id) ?? -1;
  const startAt = shot?.chatId === chatId ? indexOf(shot.startId) : -1;
  const endAt = shot?.chatId === chatId ? indexOf(shot.endId) : -1;
  const range: ShotRange | undefined =
    startAt !== -1 && endAt !== -1 ? { start: startAt, end: endAt } : undefined;
  const chosen = useMemo(
    () =>
      startAt !== -1 && endAt !== -1
        ? includedIn([...messages], { start: startAt, end: endAt }, excluded)
        : [],
    [messages, startAt, endAt, excluded],
  );
  const select = (next: ShotRange) => {
    const startId = ids[next.start];
    const endId = ids[next.end];
    if (startId && endId) setShot({ chatId, startId, endId });
  };
  const stop = () => {
    setShot(null);
    setExporting(false);
  };
  const pick = (id: string) => {
    const index = indexOf(id);
    if (!range || index === -1) return;
    const next = pickMessage(ids, { range, excluded }, index);
    select(next.range);
    setExcluded(next.excluded);
  };

  const shooting = range !== undefined;
  useEffect(() => {
    if (!shooting || exporting) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShot(null);
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [shooting, exporting]);

  return {
    ids,
    range,
    excluded,
    chosen,
    exporting,
    setExporting,
    select,
    stop,
    start: (id: string) => {
      const index = indexOf(id);
      if (index === -1) return;
      setExcluded(new Set());
      select({ start: index, end: index });
    },
    /** While framing, a click on a message changes the picture and nothing else. */
    onClickCapture: (event: React.MouseEvent) => {
      if (!range) return;
      const id = (event.target as Element)
        .closest("[data-shot-id]")
        ?.getAttribute("data-shot-id");
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      pick(id);
    },
    /**
     * Inside the frame a message is a checkbox for whether it goes in, so its
     * state is announced and the keyboard can change it.
     */
    rowProps: (id: string) => {
      const index = range ? indexOf(id) : -1;
      const inFrame = range && index >= range.start && index <= range.end;
      return {
        "data-shot-id": id,
        ...(inFrame
          ? {
              "data-shot-in": "",
              role: "checkbox",
              "aria-checked": !excluded.has(id),
              tabIndex: 0,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                pick(id);
              },
            }
          : {}),
      };
    },
  };
}

/** The sender's face beside their run; a character's opens their details. */
function SenderFace({
  sender,
}: {
  sender: { id: string; name: string; avatarUrl?: string; isSelf: boolean };
}) {
  const { byId } = useCharacters();
  const [, select] = useSelection();
  const character = sender.isSelf ? undefined : byId.get(sender.id);
  if (!character)
    return <Avatar name={sender.name} src={sender.avatarUrl} size="sm" />;
  return (
    <button
      type="button"
      aria-label={`About ${character.name}`}
      className="rounded-full transition-transform duration-150 hover:scale-108 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-95"
      onClick={() => {
        void select({ kind: "character", id: character.id });
        requestInspector();
      }}
    >
      <CharacterAvatar
        id={character.id}
        name={character.name}
        avatarUrl={character.avatarUrl}
        kind={character.kind}
        size="sm"
        decorative
      />
    </button>
  );
}

/** The time, a receipt on your own, or why it didn't go. */
function Status({
  message,
  pending,
  onRetry,
  nameOf,
  inPerson,
}: {
  message: DisplayMessage;
  pending?: PendingMessage;
  onRetry?: (message: PendingMessage) => void;
  nameOf?: (id: string) => string;
  inPerson: boolean;
}) {
  if (pending?.status === "sending") return <span>Sending…</span>;
  if (pending?.status === "failed")
    return (
      <>
        <span className="text-ui-danger">Not delivered</span>
        {onRetry ? (
          <button
            type="button"
            className="font-bold text-ui-primary hover:underline"
            onClick={() => onRetry(pending)}
          >
            Retry
          </button>
        ) : null}
      </>
    );
  const time = (
    <time dateTime={new Date(message.timestamp).toISOString()}>
      {formatTime(message.timestamp)}
    </time>
  );
  const receipt = nameOf ? messageReceipt(message) : undefined;
  if (!receipt || !nameOf) return time;
  return (
    <>
      <Receipt
        read={receipt.read}
        label={receiptLabel(receipt, nameOf, formatTime, inPerson)}
      />
      {time}
    </>
  );
}
