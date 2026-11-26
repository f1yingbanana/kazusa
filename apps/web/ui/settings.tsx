"use client";

import { Button as BaseButton } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { PaneBackButton } from "./pane-nav";

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ui-line px-6 max-sm:px-3.5">
        <PaneBackButton />
        <h1 className="min-w-0 flex-1 truncate text-base font-extrabold tracking-[-0.01em] text-ui-ink">
          {title}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6 max-sm:px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
          {description ? (
            <p className="-mb-2 text-sm leading-relaxed text-pretty text-ui-soft">
              {description}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** One titled group of settings. Sections stack directly inside SettingsPage. */
export function SettingsSection({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cx(
        "flex flex-col gap-4 border-t border-ui-line pt-7 first-of-type:border-t-0 first-of-type:pt-0",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[0.9375rem] font-extrabold text-ui-ink">
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-relaxed text-pretty text-ui-soft">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      className={cx(
        "flex flex-col divide-y divide-ui-line overflow-hidden rounded-[1rem] bg-ui-ground inset-ring inset-ring-ui-line",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function SettingsRow({
  icon,
  title,
  detail,
  action,
  fresh = false,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  fresh?: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      className={cx(
        "flex flex-col gap-3 px-4 py-3 transition-colors duration-1000 motion-reduce:transition-none",
        fresh && "bg-ui-accent-tint duration-0",
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-sm font-bold text-ui-ink">{title}</div>
          {detail ? (
            <div className="text-xs leading-normal text-pretty text-ui-soft">
              {detail}
            </div>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </div>
      {children ? <div>{children}</div> : null}
    </li>
  );
}

/** Interactive row inside a SettingsGroup, backed by ui-sdk Button for agents. */
export function SettingsRowButton({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseButton>, "className"> & {
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseButton
      {...props}
      className={cx(
        "flex w-full items-center gap-3 px-4 py-3 text-start transition-colors outline-none hover:bg-ui-tint focus-visible:bg-ui-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary data-[disabled]:cursor-default data-[disabled]:hover:bg-transparent",
        className,
      )}
    >
      {children}
    </BaseButton>
  );
}

export type StatusTone = "ok" | "pending" | "error" | "idle";

const DOT_TONE: Record<StatusTone, string> = {
  ok: "bg-ui-ok",
  pending: "bg-ui-soft motion-safe:animate-ui-pulse",
  error: "bg-ui-danger",
  idle: "bg-[color-mix(in_oklch,var(--ui-soft)_45%,transparent)]",
};

export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden
      className={cx("size-2.5 shrink-0 rounded-full", DOT_TONE[tone])}
    />
  );
}

export function StatusPill({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ui-tint px-2.5 py-1 text-xs font-bold text-ui-ink">
      <StatusDot tone={tone} />
      <span role="status">{label}</span>
    </span>
  );
}

export function Callout({
  tone = "info",
  icon,
  title,
  action,
  children,
}: {
  tone?: "info" | "danger";
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-3 rounded-[1rem] px-4 py-3 text-sm",
        tone === "danger"
          ? "bg-[color-mix(in_oklch,var(--ui-danger)_10%,var(--ui-surface))] text-ui-ink inset-ring inset-ring-[color-mix(in_oklch,var(--ui-danger)_35%,transparent)]"
          : "bg-ui-tint text-ui-ink",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cx(
            "mt-0.5 shrink-0 [&_svg]:size-4",
            tone === "danger" ? "text-ui-danger" : "text-ui-soft",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? (
          <div className="text-[0.8125rem] leading-relaxed text-pretty text-ui-soft">
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Sticky footer bar for forms with pending changes. */
export function SaveBar({
  dirty,
  saving,
  onDiscard,
  saveLabel = "Save changes",
  discardLabel = "Discard",
}: {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
  saveLabel?: string;
  discardLabel?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-[1rem] ui-raised px-4 py-2.5">
      <span className="text-sm font-semibold text-ui-soft">
        Unsaved changes
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          tone="ghost"
          size="sm"
          disabled={saving}
          onClick={onDiscard}
        >
          {discardLabel}
        </Button>
        <Button type="submit" tone="primary" size="sm" pending={saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
