"use client";

import { useState } from "react";
import type { BrainCall, BrainStep, BrainTurn, BrainUsage } from "@kazusa/client";
import {
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useBrainTrace } from "@/hooks/use-brain";
import { useCharacterStatus } from "@/hooks/use-characters";
import { formatCost, formatTokens } from "@/lib/format";
import { useSources } from "@/lib/source/provider";

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

function usageDetail(usage: BrainUsage): string {
  return [
    `${usage.input.toLocaleString()} in`,
    `${usage.output.toLocaleString()} out`,
    usage.cacheRead > 0 && `${usage.cacheRead.toLocaleString()} cached`,
    usage.cacheWrite > 0 && `${usage.cacheWrite.toLocaleString()} cache write`,
    usage.reasoning && `${usage.reasoning.toLocaleString()} reasoning`,
    usage.cost !== undefined && formatCost(usage.cost),
  ]
    .filter(Boolean)
    .join(" · ");
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[11px] tracking-wide uppercase">
        {label}
      </span>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
        {text}
      </pre>
    </div>
  );
}

function ToolStep({
  step,
  running,
}: {
  step: Extract<BrainStep, { type: "tool" }>;
  running: boolean;
}) {
  const answered = step.result !== undefined;
  const status = step.isError
    ? "error"
    : !answered && running
      ? "running"
      : undefined;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>
            {step.isError ? (
              <CircleAlertIcon />
            ) : answered ? (
              <CircleCheckIcon />
            ) : running ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <CircleDashedIcon />
            )}
          </TraceIcon>
          <TraceTitle className="font-mono text-xs">{step.name}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        <Block label="Input" text={step.input} />
        {answered ? (
          <Block label={step.isError ? "Error" : "Result"} text={step.result ?? ""} />
        ) : running ? null : (
          // The transcript can miss a result for a call that did run.
          <p className="text-xs">No result recorded. The call may still have run.</p>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function CallTrace({ call, running }: { call: BrainCall; running: boolean }) {
  return (
    <>
      <TraceLine title={call.usage ? usageDetail(call.usage) : undefined}>
        <TraceIcon>
          <SparklesIcon />
        </TraceIcon>
        <TraceTitle className="font-mono text-xs">
          {call.model ?? "Model call"}
        </TraceTitle>
        <TraceDescription className="font-mono text-xs">
          {call.usage ? `${formatTokens(call.usage.total)} tokens` : "No usage reported"}
        </TraceDescription>
      </TraceLine>
      {call.steps.map((step, index) => {
        if (step.type === "tool") {
          return <ToolStep key={step.id || index} step={step} running={running} />;
        }
        if (step.type === "thinking") {
          return (
            <TraceCollapsible key={index}>
              <TraceCollapsibleTrigger>
                <TraceLine>
                  <TraceIcon>
                    <BrainIcon />
                  </TraceIcon>
                  <TraceTitle>Thought</TraceTitle>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent className="text-sm whitespace-pre-wrap italic">
                {step.text}
              </TraceCollapsibleContent>
            </TraceCollapsible>
          );
        }
        return (
          <div key={index} className="flex min-w-0 items-start gap-2 text-sm">
            <MessageSquareIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 wrap-break-word whitespace-pre-wrap">{step.text}</p>
          </div>
        );
      })}
      {call.error ? (
        <TraceLine status="error">
          <TraceIcon>
            <CircleAlertIcon />
          </TraceIcon>
          <span className="min-w-0 wrap-break-word">{call.error}</span>
        </TraceLine>
      ) : null}
    </>
  );
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
        <span>{calls === 0 ? "Not started" : calls === 1 ? "1 LLM call" : `${calls} LLM calls`}</span>
        {turn.usage ? <span>{`${formatTokens(turn.usage.total)} tokens`}</span> : null}
        {turn.usage?.cost !== undefined ? <span>{formatCost(turn.usage.cost)}</span> : null}
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
          <CallTrace key={call.id} call={call} running={running} />
        ))}
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

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (error && !data) {
    return <p className="text-sm text-muted-foreground">{`Couldn't read this brain: ${error.message}`}</p>;
  }
  if (!data?.turns.length) {
    return (
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>No turns yet</EmptyTitle>
          <EmptyDescription>This brain hasn&apos;t been woken in its current session.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <>
      {data.turns.map((turn, index) => (
        <TurnCard key={turn.id} turn={turn} running={thinking && index === 0} />
      ))}
      {data.total > data.turns.length && limit < MAX_TURNS ? (
        <Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE_TURNS)}>
          Show older turns
        </Button>
      ) : null}
    </>
  );
}

/** Peeks at the brain session: prompts, thinking, tool calls, tokens and model. */
export function CharacterBrainButton({ id, name }: { id: string; name: string }) {
  const { resolved } = useSources();
  const thinking = useCharacterStatus(id)?.brain === "thinking";
  const [open, setOpen] = useState(false);

  if (resolved.brain !== "live") return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} />}
        >
          <BrainIcon />
          <span className="sr-only">{`Peek at ${name}'s brain`}</span>
        </TooltipTrigger>
        <TooltipContent>Peek at brain</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>{`${name}'s brain`}</SheetTitle>
            <SheetDescription>
              {thinking ? "Thinking now. " : ""}Turns from the current session, newest first, in real time.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <BrainTraceBody id={id} thinking={thinking} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
