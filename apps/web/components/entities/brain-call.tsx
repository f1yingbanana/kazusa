"use client";

import type { BrainCall, BrainUsage } from "@kazusa/client";
import {
  BrainIcon,
  CircleAlertIcon,
  MessageSquareIcon,
  SparklesIcon,
} from "lucide-react";
import { ToolStepRow } from "@/components/entities/tool-step";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { formatCost, formatTokens } from "@/lib/format";

export function usageDetail(usage: BrainUsage): string {
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

/** One LLM call as the brain view and the system admin's chat both show it. */
export function BrainCallTrace({
  call,
  running,
  thoughtsOpen = false,
}: {
  call: BrainCall;
  running: boolean;
  /** Show thoughts without a click, where they're the point of being here. */
  thoughtsOpen?: boolean;
}) {
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
          {call.usage
            ? `${formatTokens(call.usage.total)} tokens`
            : "No usage reported"}
        </TraceDescription>
      </TraceLine>
      {call.steps.map((step, index) => {
        if (step.type === "tool") {
          return (
            <ToolStepRow key={step.id || index} step={step} running={running} />
          );
        }
        if (step.type === "thinking") {
          return (
            <TraceCollapsible key={index} defaultOpen={thoughtsOpen}>
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
            <MessageSquareIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <p className="min-w-0 wrap-break-word whitespace-pre-wrap">
              {step.text}
            </p>
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
