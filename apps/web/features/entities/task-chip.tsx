"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { TextButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { timelineParsers, timelinePatch } from "../timeline/search-params";

const CHIP =
  "inline-flex items-center gap-1 rounded-full bg-ui-tint px-2 py-px align-middle text-[0.8125rem] leading-5 font-semibold whitespace-nowrap text-ui-ink [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ui-soft";

/**
 * A kind of activity as a small pill, its icon then the category's own name,
 * read inside a sentence ("finishes [🎓 studying]"); `capital` starts it with a
 * capital, for the head of a line. With `actor`, pressing it opens their
 * Timeline, where what they did is told.
 */
export function TaskChip({
  type,
  actor,
  capital = false,
  className,
}: {
  type: string;
  actor?: string;
  capital?: boolean;
  className?: string;
}) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
  });
  const Icon = taskIcon(type);
  const content = (
    <>
      <Icon aria-hidden />
      {capital ? taskLabel(type) : type}
    </>
  );
  if (!actor) return <span className={cx(CHIP, className)}>{content}</span>;
  return (
    <TextButton
      className={cx(
        CHIP,
        "transition-colors hover:bg-ui-primary/12 hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-primary",
        className,
      )}
      onClick={() => void setParams(timelinePatch([actor]))}
    >
      {content}
    </TextButton>
  );
}
