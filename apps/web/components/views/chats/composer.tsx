"use client";

import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { useComposer, type ComposerProps } from "@/hooks/use-composer";
import { cn } from "@/lib/utils";

/** How an action reads, as the message list and the scene narrate it. */
const ACTION_STYLE = "text-muted-foreground italic";

type Composing = ReturnType<typeof useComposer>;

/** The send button's name says what it sends. */
function SendLabel({ composing }: { composing: Composing }) {
  return (
    <span className="sr-only">
      {composing.acting ? "Send action" : "Send message"}
    </span>
  );
}

/**
 * The reply box under a transcript: a card with the text above and the keys and
 * Send below. Face to face, an action is written like the characters write
 * theirs, between asterisks: third person, without the subject (`*waves*`), and
 * narrated with the player's name; the draft shows in the actions' italics
 * while it would be sent as one.
 */
export function Composer(props: ComposerProps) {
  const composing = useComposer(props);
  return (
    <form
      className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        composing.submit();
      }}
    >
      <InputGroup className="rounded-2xl bg-background shadow-xs">
        <InputGroupTextarea
          value={composing.text}
          onChange={(event) => composing.change(event.target.value)}
          onBlur={composing.stopTyping}
          disabled={composing.disabled}
          onKeyDown={composing.keyDown}
          placeholder={composing.placeholder}
          aria-label="Message"
          rows={1}
          className={cn(
            "max-h-48 min-h-12 px-4 pt-3",
            composing.acting && ACTION_STYLE,
          )}
        />
        <InputGroupAddon align="block-end" className="pb-2.5">
          <InputGroupText className="hidden gap-1 text-xs xl:flex">
            <Kbd>Enter</Kbd> to send
            <span aria-hidden className="px-1">
              ·
            </span>
            <Kbd>Shift</Kbd>
            <span aria-hidden>+</span>
            <Kbd>Enter</Kbd> new line
          </InputGroupText>
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto rounded-full"
            disabled={!composing.canSend}
          >
            <ArrowUpIcon />
            <SendLabel composing={composing} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/**
 * The same reply box as the footer of a scene's dialogue panel: no card of its
 * own, the text on the panel's surface beside Send, growing to about four lines
 * (fewer in a short scene) and then scrolling. Its focus tint keeps to the
 * panel's lower corners: their radius less the panel's border.
 */
export function ReplyRow(props: Omit<ComposerProps, "placeholder">) {
  const composing = useComposer(props);
  return (
    <form
      data-reply
      className="flex shrink-0 items-end gap-2 rounded-b-[calc(var(--radius-xl)-1px)] border-t border-foreground/10 py-2 pr-2.5 pl-5 transition-colors focus-within:bg-foreground/[0.035]"
      onSubmit={(event) => {
        event.preventDefault();
        composing.submit();
      }}
    >
      <textarea
        value={composing.text}
        onChange={(event) => composing.change(event.target.value)}
        onBlur={composing.stopTyping}
        disabled={composing.disabled}
        onKeyDown={composing.keyDown}
        placeholder={composing.placeholder}
        aria-label="Message"
        rows={1}
        className={cn(
          "field-sizing-content max-h-[max(2rem,min(6.5rem,18cqh))] min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm md:leading-6",
          composing.acting && ACTION_STYLE,
        )}
      />
      <Button
        type="submit"
        size="icon-sm"
        className="rounded-full"
        disabled={!composing.canSend}
      >
        <ArrowUpIcon />
        <SendLabel composing={composing} />
      </Button>
    </form>
  );
}
