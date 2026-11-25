"use client";

import type { BrainCall, BrainUsage } from "@kazusa/client";
import {
  BrainIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { formatCost, formatTokens } from "@/lib/format";
import type { BrainActivity, ToolStep } from "@/lib/source/brain/activity";
import { Button } from "@/ui/button";
import { Trace, TraceBlock, TraceFold, TraceLine } from "@/ui/trace";

/** A long job can make hundreds of calls; the chat should stay readable. */
const SHOWN_CALLS = 6;

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

/** What the system admin did between two messages: its model calls. */
export function BrainActivityRows({
  activity,
  running,
}: {
  activity: BrainActivity;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : activity.calls.length - SHOWN_CALLS;
  const calls = hidden > 0 ? activity.calls.slice(hidden) : activity.calls;
  return (
    <div className="flex flex-col gap-1.5 ps-10">
      {hidden > 0 ? (
        <Button
          tone="link"
          size="sm"
          className="w-fit"
          onClick={() => setExpanded(true)}
        >
          {`Show ${hidden} earlier model ${hidden === 1 ? "call" : "calls"}`}
        </Button>
      ) : null}
      <Trace>
        {calls.map((call) => (
          <CallSteps key={call.id} call={call} running={running} />
        ))}
      </Trace>
    </div>
  );
}

/** The system admin is working: often for a long time before saying anything. */
export function BrainThinking() {
  return (
    <div className="ps-10">
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
    </div>
  );
}

function CallSteps({ call, running }: { call: BrainCall; running: boolean }) {
  return (
    <>
      <TraceLine
        icon={<SparklesIcon aria-hidden />}
        title={call.model ?? "Model call"}
        detail={
          call.usage
            ? `${formatTokens(call.usage.total)} tokens`
            : "No usage reported"
        }
        hint={call.usage ? usageDetail(call.usage) : undefined}
      />
      {call.steps.map((step, index) => {
        if (step.type === "tool")
          return (
            <ToolStepRow key={step.id || index} step={step} running={running} />
          );
        if (step.type === "thinking")
          return (
            <TraceFold
              key={index}
              defaultOpen
              line={
                <TraceLine icon={<BrainIcon aria-hidden />} title="Thought" />
              }
            >
              <p className="whitespace-pre-wrap italic">{step.text}</p>
            </TraceFold>
          );
        return (
          <div
            key={index}
            className="flex min-w-0 items-start gap-2 text-[0.8125rem]"
          >
            <MessageSquareIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-ui-soft"
            />
            <p className="min-w-0 wrap-break-word whitespace-pre-wrap">
              {step.text}
            </p>
          </div>
        );
      })}
      {call.error ? (
        <TraceLine
          icon={<CircleAlertIcon aria-hidden />}
          title={call.error}
          status="error"
        />
      ) : null}
    </>
  );
}

/** One tool call: its status at a glance, then what went in and came back. */
function ToolStepRow({ step, running }: { step: ToolStep; running: boolean }) {
  const answered = step.result !== undefined;
  const status = step.isError
    ? "error"
    : !answered && running
      ? "running"
      : undefined;
  const icon = step.isError ? (
    <CircleAlertIcon aria-hidden />
  ) : answered ? (
    <CircleCheckIcon aria-hidden />
  ) : running ? (
    <LoaderCircleIcon aria-hidden className="motion-safe:animate-ui-spin" />
  ) : (
    <CircleDashedIcon aria-hidden />
  );
  return (
    <TraceFold
      line={<TraceLine icon={icon} title={step.name} status={status} />}
    >
      <div className="flex flex-col gap-2">
        <TraceBlock label="Input" text={step.input} />
        {answered ? (
          <TraceBlock
            label={step.isError ? "Error" : "Result"}
            text={step.result ?? ""}
          />
        ) : running ? null : (
          // The transcript can miss a result for a call that did run.
          <p className="text-xs">
            No result recorded. The call may still have run.
          </p>
        )}
      </div>
    </TraceFold>
  );
}
