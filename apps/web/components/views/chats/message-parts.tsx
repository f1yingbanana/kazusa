"use client";

import { CheckCheckIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { DisplayMessage } from "@/lib/source/chats/runs";
import {
  actionLine,
  messageReceipt,
  receiptLabel,
} from "@/lib/source/chats/display";
import type { PendingMessage } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";

/*
 * The pieces of a transcript shared by the live chat and the screenshot it
 * makes: narrated actions and stickers.
 */

export {
  buildRuns,
  type DisplayMessage,
  type Run,
} from "@/lib/source/chats/runs";

/**
 * Something done rather than said, narrated in third person ("Kazusa leans
 * back. She sips her tea."). The stored text leaves out the subject; the name
 * is set upright so the line still reads as one sentence.
 */
export function ActionLine({
  name,
  message,
  pending,
  onRetry,
  nameOf,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onRetry"> & {
  name: string;
  message: DisplayMessage;
  pending?: PendingMessage;
  onRetry: (message: PendingMessage) => void;
  /** The last of the player's own: says who observed it. */
  nameOf?: (id: string) => string;
}) {
  const line = actionLine(name, message.text);
  const observed = nameOf && !pending && messageReceipt(message);
  return (
    <div
      className={cn("flex max-w-[80%] flex-col gap-0.5", className)}
      {...props}
    >
      {children}
      <p
        title={formatTime(message.timestamp)}
        className={cn(
          "text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground italic",
          pending?.status === "sending" && "opacity-70",
          pending?.status === "failed" && "text-destructive",
        )}
      >
        <span className="font-medium text-foreground not-italic">
          {line.subject}
        </span>
        {line.rest}
      </p>
      {pending || observed ? (
        // Inset like a bubble's footer, so receipts line up in one column.
        <span className="flex h-4 items-center justify-end gap-2 pr-3 text-xs text-muted-foreground">
          <MessageStatus
            message={message}
            pending={pending}
            onRetry={onRetry}
            nameOf={nameOf}
            inPerson
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * A character's sticker: the picture alone, without a bubble. Its text is what
 * it shows, as everyone in the chat reads it.
 */
export function StickerImage({
  url,
  alt,
  eager = false,
}: {
  url: string;
  alt: string;
  /** Off screen but needed now, as in a screenshot. */
  eager?: boolean;
}) {
  return (
    <img
      src={url}
      alt={alt}
      title={alt}
      width={128}
      height={128}
      loading={eager ? "eager" : "lazy"}
      draggable={false}
      className="size-32 object-contain"
    />
  );
}

export function MessageStatus({
  message,
  pending,
  onRetry,
  nameOf,
  inPerson = false,
}: {
  message: DisplayMessage;
  pending?: PendingMessage;
  onRetry: (message: PendingMessage) => void;
  /** The player's own: names who read or observed them. */
  nameOf?: (id: string) => string;
  /** Face to face: observed, not read. */
  inPerson?: boolean;
}) {
  if (pending?.status === "sending") {
    return <span>Sending…</span>;
  }
  if (pending?.status === "failed") {
    return (
      <>
        <span className="text-destructive">Not delivered</span>
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => onRetry(pending)}
        >
          Retry
        </Button>
      </>
    );
  }
  const time = (
    <time
      dateTime={new Date(message.timestamp).toISOString()}
      className="font-mono text-[11px] tabular-nums"
    >
      {formatTime(message.timestamp)}
    </time>
  );
  const receipt = nameOf ? messageReceipt(message) : undefined;
  if (!receipt || !nameOf) return time;
  const label = receiptLabel(receipt, nameOf, formatTime, inPerson);
  const Icon = receipt.read ? CheckCheckIcon : CheckIcon;
  return (
    // The check before the time, so times end the line in one column.
    <span className="flex items-center gap-1">
      <Icon
        role="img"
        aria-label={label}
        className={cn(
          "size-3.5",
          receipt.read ? "text-primary" : "text-muted-foreground",
        )}
      >
        <title>{label}</title>
      </Icon>
      {time}
    </span>
  );
}
