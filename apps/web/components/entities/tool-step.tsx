"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
} from "lucide-react";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { ToolStep } from "@/lib/source/brain/activity";

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

/** One tool call: its status at a glance, then what went in and came back. */
export function ToolStepRow({
  step,
  running,
}: {
  step: ToolStep;
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
          <Block
            label={step.isError ? "Error" : "Result"}
            text={step.result ?? ""}
          />
        ) : running ? null : (
          // The transcript can miss a result for a call that did run.
          <p className="text-xs">
            No result recorded. The call may still have run.
          </p>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
