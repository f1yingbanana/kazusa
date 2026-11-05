"use client";

import { useState } from "react";
import type { BrainTurn } from "@kazusa/client";
import {
  BotIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  UserIcon,
} from "lucide-react";
import { BrainCallTrace, usageDetail } from "@/components/entities/brain-call";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useBrainTrace } from "@/hooks/use-brain";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { useCharacterStatus } from "@/hooks/use-characters";
import { formatCost, formatTokens } from "@/lib/format";

const PAGE_TURNS = 20;
const MAX_TURNS = 100;

/** Real time, not sim time: this view is a debug window onto the host (D6). */
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
  const models = [...new Set(turn.calls.flatMap((call) => call.model ?? []))];
  const calls = turn.calls.length;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <header
        title={turn.usage ? usageDetail(turn.usage) : undefined}
        className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-muted-foreground tabular-nums"
      >
        <time className="text-foreground">{realTime(turn.at)}</time>
        <span>
          {calls === 0
            ? turn.error
              ? "Failed"
              : "Not started"
            : calls === 1
              ? "1 LLM call"
              : `${calls} LLM calls`}
        </span>
        {turn.usage ? (
          <span>{`${formatTokens(turn.usage.total)} tokens`}</span>
        ) : null}
        {turn.usage?.cost !== undefined ? (
          <span>{formatCost(turn.usage.cost)}</span>
        ) : null}
        {models.length > 1 ? <span>{`${models.length} models`}</span> : null}
      </header>
      <Trace>
        {turn.prompts.map((prompt, index) => (
          <TraceCollapsible key={index}>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceIcon>
                  <UserIcon />
                </TraceIcon>
                <TraceTitle>{prompt}</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent className="text-sm whitespace-pre-wrap">
              {prompt}
            </TraceCollapsibleContent>
          </TraceCollapsible>
        ))}
        {turn.calls.map((call) => (
          <BrainCallTrace key={call.id} call={call} running={running} />
        ))}
        {turn.error && !running ? (
          <TraceLine status="error">
            <TraceIcon>
              <CircleAlertIcon />
            </TraceIcon>
            <span className="min-w-0 wrap-break-word">{turn.error}</span>
          </TraceLine>
        ) : null}
        {running ? (
          <TraceLine status="running">
            <TraceIcon>
              <LoaderCircleIcon className="animate-spin" />
            </TraceIcon>
            <TraceTitle>Thinking</TraceTitle>
          </TraceLine>
        ) : null}
      </Trace>
    </article>
  );
}

function BrainTraceBody({ id, thinking }: { id: string; thinking: boolean }) {
  const [limit, setLimit] = useState(PAGE_TURNS);
  const { data, error, isLoading } = useBrainTrace(id, limit, thinking);
  const { scroller, content, onScroll } = useFollowBottom();

  const frame = (children: React.ReactNode) => (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto p-4"
    >
      <div ref={content} className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );

  if (isLoading && !data) {
    return frame(
      <div className="flex flex-col gap-3" aria-hidden>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>,
    );
  }
  if (error && !data) {
    return frame(
      <p className="text-sm text-muted-foreground">{`Couldn't read this brain: ${error.message}`}</p>,
    );
  }
  if (!data?.turns.length) {
    return frame(
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>No turns yet</EmptyTitle>
          <EmptyDescription>
            This brain hasn&apos;t been woken in its current session.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }
  return frame(
    <>
      {data.total > data.turns.length && limit < MAX_TURNS ? (
        <Button
          variant="outline"
          size="sm"
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
    </>,
  );
}

/** Peeks at the brain session: prompts, thinking, tool calls, tokens and model. */
/** The current brain session's turns, followed live while open. */
export function CharacterBrainSheet({
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{`${name}'s brain`}</SheetTitle>
          <SheetDescription>
            {thinking ? "Thinking now. " : ""}Turns from the current session,
            newest at the bottom, in real time.
          </SheetDescription>
        </SheetHeader>
        {open ? <BrainTraceBody id={id} thinking={thinking} /> : null}
      </SheetContent>
    </Sheet>
  );
}
