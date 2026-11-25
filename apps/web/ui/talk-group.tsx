import { ChevronRightIcon, SpeechIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

/**
 * People talking together, on one shared surface: their rows (`ListRow`s in
 * `<li>`s) and, at its foot, the latest line, which opens the talk. While
 * someone speaks, the line gives way to who is speaking, with dots, and the
 * icon beats. Render it as the child of a `<li>`.
 */
export function TalkGroup({
  label,
  line,
  speaking,
  openLabel,
  current,
  onOpen,
  children,
}: {
  /** Names the group for assistive tech, like "Noa and Yuuka talking". */
  label: string;
  line?: ReactNode;
  /** Who is speaking now, in words; nobody when absent. */
  speaking?: string;
  /** What opening it does, for assistive tech: "Listen in", "Join the talk". */
  openLabel: string;
  current?: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  /** The people in it, as list items. */
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-current={current || undefined}
      className="flex flex-col rounded-[1.25rem] bg-ui-accent-tint p-1 transition-shadow duration-200 data-current:inset-ring-2 data-current:inset-ring-ui-accent motion-safe:animate-ui-enter"
    >
      <ul className="flex flex-col">{children}</ul>
      <button
        type="button"
        onClick={onOpen}
        className="group/line flex w-full items-start gap-2.5 rounded-[1rem] px-3 py-2 text-start text-[0.8125rem] leading-snug transition-colors duration-150 hover:bg-ui-surface/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary"
      >
        <span className="relative mt-px grid size-4 shrink-0 place-items-center text-ui-accent-ink [&_svg]:size-4">
          <SpeechIcon aria-hidden />
          {speaking ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-ui-accent/40 motion-safe:animate-ui-ping"
            />
          ) : null}
        </span>
        <span className="sr-only">{`${openLabel}: `}</span>
        {speaking ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-ui-accent-ink">
            <span className="truncate">{speaking}</span>
            <span aria-hidden="true" className="inline-flex gap-0.5 pt-0.5">
              {DOTS.map((delay) => (
                <span
                  key={delay}
                  className={cx(
                    "size-1 rounded-full bg-current motion-safe:animate-ui-dot",
                    delay,
                  )}
                />
              ))}
            </span>
          </span>
        ) : (
          <span className="line-clamp-2 min-w-0 flex-1 text-ui-ink/80">
            {line ?? openLabel}
          </span>
        )}
        <ChevronRightIcon
          aria-hidden
          className="mt-px size-4 shrink-0 text-ui-soft opacity-0 transition-opacity duration-150 group-hover/line:opacity-100 group-focus-visible/line:opacity-100 rtl:rotate-180"
        />
      </button>
    </div>
  );
}

const DOTS = [
  "[animation-delay:0ms]",
  "[animation-delay:160ms]",
  "[animation-delay:320ms]",
];
