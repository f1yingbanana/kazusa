"use client";

import { Button as Base } from "@ui-sdk/react/button";
import { LoaderCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip } from "./tooltip";

const BASE =
  "inline-flex h-9 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-bold whitespace-nowrap transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:active:scale-100 data-[pending]:cursor-wait data-[pending]:data-[disabled]:opacity-100 [&_svg]:size-4 [&_svg]:shrink-0";

const TONE = {
  soft: "bg-ui-tint text-ui-ink hover:bg-[color-mix(in_oklch,var(--ui-tint),var(--ui-ink)_8%)]",
  primary:
    "bg-ui-primary text-ui-on-primary hover:bg-[color-mix(in_oklch,var(--ui-primary),black_10%)]",
  accent: "bg-ui-accent text-ui-on-accent",
  ghost: "text-ui-soft hover:bg-ui-tint hover:text-ui-ink",
  link: "h-auto px-0 text-ui-primary active:scale-100",
  danger:
    "text-ui-danger hover:bg-[color-mix(in_oklch,var(--ui-danger),transparent_90%)]",
} as const;

const SIZE = { sm: "h-7.5 px-3 text-[0.8125rem]", md: "", lg: "h-10" } as const;
const ICON_SIZE = { sm: "w-7.5", md: "w-9", lg: "w-10" } as const;

type Tone = keyof typeof TONE;
type Size = keyof typeof SIZE;

/** A button's look, for a trigger that renders its own element. */
export function buttonClass({
  tone = "soft",
  size = "md",
  className,
}: { tone?: Tone; size?: Size; className?: string } = {}): string {
  return cx(BASE, SIZE[size], TONE[tone], className);
}
type BaseProps = Omit<ComponentProps<typeof Base>, "className" | "children">;

/* While it waits a spinner takes the icon's place; the label never changes. */
const SPINNER =
  "hidden in-data-[pending]:block motion-safe:in-data-[pending]:animate-ui-spin";

export function Button({
  tone = "soft",
  size = "md",
  icon,
  pending = false,
  collapse,
  title,
  className,
  children,
  ...props
}: BaseProps & {
  tone?: Tone;
  size?: Size;
  icon?: ReactNode;
  /**
   * Waiting on something the button can't see, like the form it submits. An
   * `onClick` that returns a Promise needs nothing: the button waits for it.
   */
  pending?: boolean;
  /**
   * Hide the label in a narrow container. `title` stays as the tooltip and the
   * name.
   */
  collapse?: boolean;
  /** Its tooltip: the name when it collapses, or why it's off. */
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const button = (
    <Base
      {...props}
      disabled={pending || props.disabled}
      data-pending={pending || undefined}
      focusableWhenDisabled={
        title || pending ? true : props.focusableWhenDisabled
      }
      aria-label={
        collapse ? (props["aria-label"] ?? title) : props["aria-label"]
      }
      data-tone={tone}
      className={cx(
        BASE,
        SIZE[size],
        TONE[tone],
        collapse && "@max-[22rem]:w-9 @max-[22rem]:px-0",
        className,
      )}
    >
      {icon ? (
        <span className="contents in-data-pending:hidden">{icon}</span>
      ) : null}
      <LoaderCircleIcon aria-hidden className={SPINNER} />
      {children != null ? (
        <span
          className={cx(
            typeof children === "string" || typeof children === "number"
              ? "min-w-0 truncate"
              : "inline-flex min-w-0 items-center gap-1.5",
            collapse && "@max-[22rem]:hidden",
          )}
        >
          {children}
        </span>
      ) : null}
    </Base>
  );
  return title ? (
    <Tooltip label={title} names={collapse}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/**
 * A button that is only an icon. `label` names it and is its tooltip, unless
 * `title` says something else there (why it's off).
 */
export function IconButton({
  label,
  title,
  tone = "ghost",
  size = "lg",
  pending = false,
  tooltipSide,
  className,
  children,
  ...props
}: BaseProps & {
  label: string;
  title?: string;
  tone?: Tone;
  size?: Size;
  pending?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip label={title ?? label} names={!title} side={tooltipSide}>
      <Base
        {...props}
        disabled={pending || props.disabled}
        data-pending={pending || undefined}
        focusableWhenDisabled
        aria-label={label}
        data-tone={tone}
        className={cx(
          BASE,
          SIZE[size],
          TONE[tone],
          "px-0",
          ICON_SIZE[size],
          className,
        )}
      >
        {children ? (
          <span className="contents in-data-pending:hidden">{children}</span>
        ) : null}
        <LoaderCircleIcon aria-hidden className={SPINNER} />
      </Base>
    </Tooltip>
  );
}

/**
 * A press that reads as words in a line, like a name in "You are Sensei": no
 * box of its own, so `className` draws it.
 */
export function TextButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Base>, "className"> & { className?: string }) {
  return <Base {...props} className={className} />;
}
