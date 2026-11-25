"use client";

import { useComposer, type ComposerProps } from "@/hooks/use-composer";
import { ComposerBox } from "@/ui/composer";

/**
 * The reply box of a conversation: the chat's own draft (shared by a talk's
 * scene and its transcript), typing signals while there's text, and, face to
 * face, a line wrapped in asterisks sent as something done, set in italics as
 * you write it. `flat` draws it on a scene's panel.
 */
export function ReplyBox({
  flat = false,
  morph,
  className,
  ...props
}: ComposerProps & {
  flat?: boolean;
  /** A view transition name, to morph into what stands in for it elsewhere. */
  morph?: string;
  className?: string;
}) {
  const composing = useComposer(props);
  return (
    <ComposerBox
      value={composing.text}
      onValueChange={composing.change}
      onSubmit={composing.submit}
      onBlur={composing.stopTyping}
      label="Message"
      sendLabel={composing.acting ? "Send action" : "Send message"}
      placeholder={composing.placeholder}
      canSend={composing.canSend}
      disabled={composing.disabled}
      emphasis={composing.acting}
      flat={flat}
      closes={props.canAct ? "*" : undefined}
      morph={morph}
      className={className}
    />
  );
}
