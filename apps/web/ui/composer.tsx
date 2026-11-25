"use client";

import { Button } from "@ui-sdk/react/button";
import { Textarea } from "@ui-sdk/react/textarea";
import { ArrowUpIcon } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * Where a reply box sits at the foot of a conversation: the same margins under
 * a transcript and under a scene's dialogue, so switching between them leaves
 * the box where it was.
 */
export const COMPOSER_DOCK = "px-3 pb-3 sm:px-6 sm:pb-5";

/**
 * Where a reply is written: a pill that grows with its text to about six lines,
 * and a send button that swells in once there's something to send. Enter sends
 * and Shift+Enter starts a line, never while an input method is composing.
 * `emphasis` sets the draft in italics, for something done rather than said.
 * `flat` drops the pill, for a box drawn on another surface, keeping its
 * padding, so its text and send button sit where the pill's would. `closes` is
 * a character that, typed into the empty box, brings its closing twin with the
 * caret between them; typed again just before that twin, it steps over it.
 */
export function ComposerBox({
  value,
  onValueChange,
  onSubmit,
  onBlur,
  label,
  sendLabel,
  placeholder,
  canSend,
  disabled = false,
  emphasis = false,
  flat = false,
  closes,
  morph,
  before,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onBlur?: () => void;
  label: string;
  sendLabel: string;
  placeholder?: string;
  canSend: boolean;
  disabled?: boolean;
  emphasis?: boolean;
  flat?: boolean;
  closes?: string;
  /** A view transition name, so the box can morph into another surface. */
  morph?: string;
  /** Beside the text, before it: a hint or a mode. */
  before?: ReactNode;
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  function pair(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!closes || event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    const at = el.selectionStart;
    if (at !== el.selectionEnd) return;
    const twin = closes + closes;
    if (event.key === closes && value === "") {
      event.preventDefault();
      caret.current = 1;
      onValueChange(twin);
    } else if (
      event.key === closes &&
      value.length > 1 &&
      value.startsWith(closes) &&
      value.endsWith(closes) &&
      at === value.length - 1
    ) {
      event.preventDefault();
      el.setSelectionRange(at + 1, at + 1);
    } else if (event.key === "Backspace" && value === twin && at === 1) {
      event.preventDefault();
      onValueChange("");
    }
  }

  return (
    <form
      style={morph ? { viewTransitionName: morph } : undefined}
      className={cx(
        "group/composer flex items-end gap-1.5 transition-[box-shadow,background-color] duration-200",
        flat
          ? "p-1.5 ps-4.5 focus-within:bg-[color-mix(in_oklch,var(--ui-ink),transparent_96%)]"
          : "rounded-[1.5rem] bg-ui-surface p-1.5 ps-4.5 shadow-ui inset-ring inset-ring-ui-line focus-within:inset-ring-2 focus-within:inset-ring-ui-primary",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {before}
      <Textarea
        ref={field}
        onKeyDown={pair}
        autoResize
        rows={1}
        value={value}
        onValueChange={(next) => onValueChange(next)}
        submitShortcut="enter"
        onSubmit={() => onSubmit()}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        className={cx(
          "max-h-[9.5rem] min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 text-ui-ink outline-none placeholder:text-ui-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 md:text-[0.9375rem]",
          emphasis && "text-ui-soft italic",
        )}
      />
      <Button
        type="submit"
        disabled={!canSend}
        aria-label={sendLabel}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-ui-primary text-ui-on-primary transition-[scale,opacity,background-color] duration-250 ease-[cubic-bezier(0.3,1.5,0.5,1)] hover:bg-[color-mix(in_oklch,var(--ui-primary),black_10%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-85 data-[disabled]:scale-75 data-[disabled]:bg-ui-tint data-[disabled]:text-ui-soft motion-reduce:transition-none [&_svg]:size-4.5 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:-translate-y-0.5"
      >
        <ArrowUpIcon aria-hidden strokeWidth={2.5} />
      </Button>
    </form>
  );
}
