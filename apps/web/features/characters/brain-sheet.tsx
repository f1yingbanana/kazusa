"use client";

import type { BrainTurn } from "@kazusa/client";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  MessageSquareQuoteIcon,
} from "lucide-react";
import { useState } from "react";
import { useBrainTrace } from "@/hooks/use-brain";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { formatCost, formatTokens } from "@/lib/format";
import { Button } from "@/ui/button";
import { Drawer, DrawerPanel } from "@/ui/drawer";
import { Note } from "@/ui/note";
import { Trace, TraceFold, TraceLine } from "@/ui/trace";
import { CallSteps } from "../chats/brain-activity";

const PAGE_TURNS = 20;
const MAX_TURNS = 100;

/** Real time, not sim time: this view is a debug window onto the host. */
function realTime(at: number | undefined): string {
  return at === undefined
    ? ""
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function TurnCard({ turn, running }: { turn: BrainTurn; running: boolean }) {
  const models = new Set(turn.calls.flatMap((call) => call.model ?? []));
  const calls = turn.calls.length;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[1rem] bg-ui-ground p-3.5 inset-ring inset-ring-ui-line">
      <header className="flex flex-wrap items-baseline gap-x-2 text-xs text-ui-soft tabular-nums">
        <time className="font-bold text-ui-ink">{realTime(turn.at)}</time>
        <span>
          {calls === 0
            ? turn.error
              ? "Failed"
              : "Not started"
            : calls === 1
              ? "1 model call"
              : `${calls} model calls`}
        </span>
        {turn.usage ? (
          <span>{`${formatTokens(turn.usage.total)} tokens`}</span>
        ) : null}
        {turn.usage?.cost !== undefined ? (
          <span>{formatCost(turn.usage.cost)}</span>
        ) : null}
        {models.size > 1 ? <span>{`${models.size} models`}</span> : null}
      </header>
      <Trace>
        {turn.prompts.map((prompt, index) => (
          <TraceFold
            key={index}
            line={
              <TraceLine
                icon={<MessageSquareQuoteIcon aria-hidden />}
                title={prompt}
              />
            }
          >
            <p className="whitespace-pre-wrap">{prompt}</p>
          </TraceFold>
        ))}
        {turn.calls.map((call) => (
          <CallSteps key={call.id} call={call} running={running} />
        ))}
        {turn.error && !running ? (
          <TraceLine
            icon={<CircleAlertIcon aria-hidden />}
            title={turn.error}
            status="error"
          />
        ) : null}
        {running ? (
          <TraceLine
            icon={
              <LoaderCircleIcon
                aria-hidden
                className="motion-safe:animate-ui-spin"
              />
            }
            title="Thinking"
            status="running"
          />
        ) : null}
      </Trace>
    </article>
  );
}

function Turns({ id, thinking }: { id: string; thinking: boolean }) {
  const [limit, setLimit] = useState(PAGE_TURNS);
  const { data, error, isLoading } = useBrainTrace(id, limit, thinking);
  const { scroller, content, onScroll } = useFollowBottom();
  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto p-4"
    >
      <div ref={content} className="flex flex-col gap-3">
        {isLoading && !data ? (
          <Note>Loading…</Note>
        ) : error && !data ? (
          <Note>{`Couldn't read this brain: ${error.message}`}</Note>
        ) : !data?.turns.length ? (
          <Note>No turns yet in this session.</Note>
        ) : (
          <>
            {data.total > data.turns.length && limit < MAX_TURNS ? (
              <Button
                tone="soft"
                size="sm"
                className="self-center"
                onClick={() => setLimit(limit + PAGE_TURNS)}
              >
                Show older turns
              </Button>
            ) : null}
            {data.turns.toReversed().map((turn, index, turns) => (
              <TurnCard
                key={turn.id}
                turn={turn}
                running={thinking && index === turns.length - 1}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The current brain session's turns, newest at the bottom and followed live
 * while open: what woke them, their thoughts, tools, tokens and model.
 */
export function BrainSheet({
  id,
  name,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const thinking = useCharacterStatus(id)?.brain === "thinking";
  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="right">
      <DrawerPanel title={`${name}'s brain`} heading size="lg">
        <div className="flex flex-col">
          <p className="border-b border-ui-line px-5 py-2.5 text-xs text-ui-soft">
            {thinking ? "Thinking now. " : ""}Turns from the current session, in
            real time.
          </p>
          {open ? <Turns id={id} thinking={thinking} /> : null}
        </div>
      </DrawerPanel>
    </Drawer>
  );
}
