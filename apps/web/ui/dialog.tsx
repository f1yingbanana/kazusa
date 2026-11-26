"use client";

import {
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { BACKDROP } from "./overlay";

export { Dialog, DialogClose, DialogTrigger } from "@ui-sdk/react/dialog";
export { AlertDialog, AlertDialogTrigger } from "@ui-sdk/react/alert-dialog";

const FADE =
  "transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none";

/* Rises a little as it opens, and sinks as it goes; a sheet on a phone. */
const SURFACE =
  "fixed z-55 flex flex-col gap-4 bg-ui-surface p-5 text-ui-ink shadow-ui outline-none transition-[opacity,translate,scale] duration-250 ease-[cubic-bezier(0.2,0.9,0.3,1)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:left-1/2 sm:-translate-1/2 sm:rounded-[1.5rem] sm:data-[ending-style]:scale-96 sm:data-[starting-style]:scale-96 max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[calc(100dvh-3rem)] max-sm:rounded-t-[1.5rem] max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:ui-sheet-tail max-sm:data-[ending-style]:translate-y-8 max-sm:data-[starting-style]:translate-y-8";

const WIDTH = {
  sm: "sm:w-[min(24rem,calc(100vw-2rem))]",
  md: "sm:w-[min(28rem,calc(100vw-2rem))]",
  lg: "sm:w-[min(42rem,calc(100vw-2rem))]",
} as const;

const TITLE = "text-lg leading-tight font-extrabold";
const TEXT = "text-sm leading-normal text-pretty text-ui-soft";

/**
 * A focused task over the page: its title, a line saying what it's for, the
 * body, and the answers at its foot. `full` takes the whole screen on a phone.
 */
export function DialogPanel({
  title,
  description,
  footer,
  size = "md",
  full = false,
  closable = false,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTH;
  full?: boolean;
  /** A close button at the top right, for a dialog with no Cancel. */
  closable?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <DialogBackdrop className={cx(BACKDROP, FADE)} />
      <DialogContent
        className={cx(
          SURFACE,
          WIDTH[size],
          "sm:max-h-[min(40rem,90dvh)]",
          full &&
            "max-sm:top-0 max-sm:max-h-none max-sm:rounded-none max-sm:pt-[max(1.25rem,env(safe-area-inset-top))]",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle className={TITLE}>{title}</DialogTitle>
            {description ? (
              <DialogDescription className={TEXT}>
                {description}
              </DialogDescription>
            ) : null}
          </div>
          {closable ? (
            <DialogClose
              aria-label="Close"
              className="-me-2 -mt-1.5 grid size-9 shrink-0 place-items-center rounded-full text-ui-soft hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary [&_svg]:size-4"
            >
              <XIcon aria-hidden />
            </DialogClose>
          ) : null}
        </div>
        {children}
        {footer ? <DialogFoot>{footer}</DialogFoot> : null}
      </DialogContent>
    </>
  );
}

/** The answers, at the end of the row; stacked full width on a phone. */
export function DialogFoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-end gap-2 max-sm:flex-col-reverse max-sm:*:w-full">
      {children}
    </div>
  );
}

const ANSWER =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold transition-[scale,background-color] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-[disabled]:opacity-50";

/**
 * A question that needs an answer before going on, answered Cancel or Confirm:
 * the title and description say what confirming does. `danger` draws Confirm as
 * something that can't be taken back lightly. `children` explains more under
 * the description; `aside` is another way out, before Cancel.
 */
export function AlertPanel({
  title,
  description,
  danger = false,
  size = "sm",
  agentConfirm,
  aside,
  children,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  danger?: boolean;
  size?: keyof typeof WIDTH;
  /** What an agent is told before it may press Confirm. */
  agentConfirm?: string;
  aside?: ReactNode;
  children?: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <>
      <AlertDialogBackdrop className={cx(BACKDROP, FADE)} />
      <AlertDialogContent className={cx(SURFACE, WIDTH[size])}>
        <div className="flex flex-col gap-1">
          <AlertDialogTitle className={TITLE}>{title}</AlertDialogTitle>
          <AlertDialogDescription className={TEXT}>
            {description}
          </AlertDialogDescription>
        </div>
        {children}
        <DialogFoot>
          {aside ? <div className="max-sm:contents">{aside}</div> : null}
          <AlertDialogClose
            className={cx(
              ANSWER,
              "bg-ui-tint text-ui-ink hover:bg-[color-mix(in_oklch,var(--ui-tint),var(--ui-ink)_8%)]",
            )}
          >
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            value="confirm"
            data-agent-confirm={agentConfirm}
            onClick={onConfirm}
            className={cx(
              ANSWER,
              danger
                ? "bg-ui-danger text-ui-ground hover:bg-[color-mix(in_oklch,var(--ui-danger),black_10%)]"
                : "bg-ui-primary text-ui-on-primary hover:bg-[color-mix(in_oklch,var(--ui-primary),black_10%)]",
            )}
          >
            Confirm
          </AlertDialogClose>
        </DialogFoot>
      </AlertDialogContent>
    </>
  );
}
