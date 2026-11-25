import { CheckCheckIcon, CheckIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { VisuallyHidden } from "./visually-hidden";

export type Side = "start" | "end";
/** Where a bubble sits in its sender's run, which rounds its corners. */
export type RunPosition = "single" | "first" | "middle" | "last";
export type BubbleTone = "theirs" | "mine" | "failed";

/*
  Messages arriving live rise from their sender's side; those already there when
  the conversation opened don't move. `enter` is the caller's to decide.
*/
const ENTER =
  "motion-safe:animate-ui-message-in data-[side=start]:origin-bottom-left data-[side=end]:origin-bottom-right rtl:data-[side=start]:origin-bottom-right rtl:data-[side=end]:origin-bottom-left";

/**
 * One sender's run of messages: their face beside the last, their name over the
 * first. Your own sit at the end with neither.
 */
export function MessageRun({
  side,
  face,
  name,
  children,
}: {
  side: Side;
  /** The sender's face, or a button holding it. */
  face?: ReactNode;
  name?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-side={side}
      className="group/run flex items-end gap-2 data-[side=end]:flex-row-reverse"
    >
      {side === "start" ? (
        <span className="flex w-8 shrink-0 justify-center pb-5">{face}</span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 group-data-[side=end]/run:items-end">
        {name ? (
          <span className="ps-3 pb-0.5 text-xs font-bold text-ui-soft">
            {name}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}

const CORNERS: Record<Side, Record<RunPosition, string>> = {
  start: {
    single: "",
    first: "rounded-es-[0.4rem]",
    middle: "rounded-ss-[0.4rem] rounded-es-[0.4rem]",
    last: "rounded-ss-[0.4rem]",
  },
  end: {
    single: "",
    first: "rounded-ee-[0.4rem]",
    middle: "rounded-se-[0.4rem] rounded-ee-[0.4rem]",
    last: "rounded-se-[0.4rem]",
  },
};

const TONE: Record<BubbleTone, string> = {
  theirs: "bg-ui-tint text-ui-ink",
  mine: "bg-ui-primary text-ui-on-primary",
  failed:
    "bg-ui-surface text-ui-ink inset-ring-2 inset-ring-ui-danger [&_a]:text-ui-danger",
};

/**
 * A line of text in a bubble. Its row holds `actions` beside it, shown while
 * the pointer is over the row or something in it has focus.
 */
export function Bubble({
  side,
  tone,
  position = "single",
  sending = false,
  enter = false,
  actions,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  side: Side;
  tone: BubbleTone;
  position?: RunPosition;
  /** On its way: faded until it lands. */
  sending?: boolean;
  enter?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      {...props}
      data-side={side}
      className={cx(
        "group/line relative w-fit max-w-[min(80%,36rem)]",
        enter && ENTER,
        className,
      )}
    >
      <p
        className={cx(
          "rounded-[1.25rem] px-3.5 py-2 text-[0.9375rem] leading-[1.45] wrap-break-word whitespace-pre-wrap transition-opacity duration-300",
          TONE[tone],
          CORNERS[side][position],
          sending && "opacity-60",
        )}
      >
        {children}
      </p>
      {actions ? <ActionsSlot>{actions}</ActionsSlot> : null}
    </div>
  );
}

/**
 * Something done rather than said, told in the third person: the doer's name
 * upright, the rest in italics, no bubble.
 */
export function Narration({
  side,
  subject,
  rest,
  title,
  failed = false,
  sending = false,
  enter = false,
  actions,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  side: Side;
  subject: string;
  rest: string;
  title?: string;
  failed?: boolean;
  sending?: boolean;
  enter?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      {...props}
      data-side={side}
      className={cx(
        "group/line relative w-fit max-w-[min(85%,38rem)]",
        enter && ENTER,
        className,
      )}
    >
      <p
        title={title}
        className={cx(
          "text-[0.9375rem] leading-[1.5] whitespace-pre-wrap italic transition-opacity duration-300 group-data-[side=end]/line:text-end",
          failed ? "text-ui-danger" : "text-ui-soft",
          sending && "opacity-60",
        )}
      >
        <span className="font-bold text-ui-ink not-italic">{subject}</span>
        {rest}
      </p>
      {actions ? <ActionsSlot>{actions}</ActionsSlot> : null}
    </div>
  );
}

/** A sticker: the picture alone, its words as its name. */
export function Sticker({
  src,
  alt,
  side,
  eager = false,
  enter = false,
  actions,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  src: string;
  alt: string;
  side: Side;
  eager?: boolean;
  enter?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      {...props}
      data-side={side}
      className={cx("group/line relative w-fit", enter && ENTER, className)}
    >
      <img
        src={src}
        alt={alt}
        title={alt}
        width={128}
        height={128}
        loading={eager ? "eager" : "lazy"}
        draggable={false}
        className="size-32 object-contain"
      />
      {actions ? <ActionsSlot>{actions}</ActionsSlot> : null}
    </div>
  );
}

/**
 * Where a line's actions float: beside it toward the middle with a mouse, above
 * it on touch. Out of the flow, so a line is as wide as its words.
 */
function ActionsSlot({ children }: { children: ReactNode }) {
  return (
    <div
      className={cx(
        "absolute z-10",
        "pointer-fine:top-1/2 pointer-fine:-translate-y-1/2 pointer-fine:group-data-[side=start]/line:inset-s-full pointer-fine:group-data-[side=start]/line:ps-1.5 pointer-fine:group-data-[side=end]/line:inset-e-full pointer-fine:group-data-[side=end]/line:pe-1.5",
        "pointer-coarse:bottom-full pointer-coarse:pb-1.5 pointer-coarse:group-data-[side=start]/line:inset-s-0 pointer-coarse:group-data-[side=end]/line:inset-e-0",
      )}
    >
      {children}
    </div>
  );
}

/** The line under a run: the time, a receipt, or what went wrong. */
export function MessageFoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-5 items-center gap-1.5 px-3 text-[0.6875rem] font-semibold text-ui-soft tabular-nums">
      {children}
    </div>
  );
}

/**
 * Sent, or taken in by everyone it reached. A check that turns double pops, so
 * the moment it's read is seen.
 */
export function Receipt({ read, label }: { read: boolean; label: string }) {
  const Icon = read ? CheckCheckIcon : CheckIcon;
  return (
    <span className="inline-flex" title={label}>
      <Icon
        key={read ? "read" : "sent"}
        aria-hidden
        className={cx(
          "size-3.5",
          read && "text-ui-accent-ink motion-safe:animate-ui-pop",
        )}
      />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}

/** A day's first message is headed with the day. */
export function DayMark({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 text-xs font-bold text-ui-soft before:h-px before:flex-1 before:bg-ui-line after:h-px after:flex-1 after:bg-ui-line">
      {children}
    </div>
  );
}

const DOTS = [
  "[animation-delay:0ms]",
  "[animation-delay:160ms]",
  "[animation-delay:320ms]",
];

/**
 * Someone writing a reply: three dots that rise in turn, in a bubble of their
 * own. `label` is what a screen reader hears.
 */
export function TypingBubble({ label }: { label: string }) {
  return (
    <div className="flex origin-bottom-left items-center gap-1 self-start rounded-[1.25rem] bg-ui-tint px-4 py-3.5 motion-safe:animate-ui-message-in rtl:origin-bottom-right">
      {DOTS.map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className={cx(
            "size-1.5 rounded-full bg-ui-soft motion-safe:animate-ui-dot",
            delay,
          )}
        />
      ))}
      <VisuallyHidden>{label}</VisuallyHidden>
    </div>
  );
}

/** Placeholder bubbles while the history loads. */
export function MessagesLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {["w-2/5", "ms-auto w-1/3", "w-1/2 h-16"].map((size) => (
        <span
          key={size}
          className={cx(
            "h-10 rounded-[1.25rem] bg-ui-tint motion-safe:animate-ui-pulse",
            size,
          )}
        />
      ))}
    </div>
  );
}
