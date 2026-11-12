"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { entityRefParser } from "@/lib/state/entity-ref";
import { chatsParsers } from "@/components/views/chats/search-params";
import { memo } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import type { JournalEvent } from "@kazusa/client";
import { CharacterChip, useChatTitle } from "@/components/entities/chips";
import { Thought } from "@/components/entities/fact";
import { Button } from "@/components/ui/button";
import { useCharacter } from "@/hooks/use-characters";
import { kindOf } from "@/lib/registry/timeline-kinds";
import type { StageLink } from "@/lib/registry/types";
import { formatSimTime } from "@/lib/time/sim";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 3;

function ThoughtAttribution({ by, text }: { by: string; text: string }) {
  const character = useCharacter(by);
  return <Thought by={character?.name ?? by}>{text}</Thought>;
}

/**
 * Says whether it joins a chat or peeks at one, and hides if neither is
 * possible.
 */
function ChatLink({ link, chatId }: { link: StageLink; chatId: string }) {
  const { mine, readable } = useChatTitle(chatId);
  const [, setParams] = useQueryStates({
    view: parseAsString,
    sel: entityRefParser,
    "chats.id": chatsParsers["chats.id"],
    "chats.msg": chatsParsers["chats.msg"],
  });
  if (!readable) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      className="shrink-0 self-start text-muted-foreground"
      onClick={() =>
        void setParams({
          view: link.view,
          ...link.params,
          sel: { kind: "chat", id: chatId },
        })
      }
    >
      {mine ? link.label : (link.observedLabel ?? link.label)}
      <ArrowUpRightIcon data-icon="inline-end" />
    </Button>
  );
}

export const TimelineRow = memo(function TimelineRow({
  event,
  compact = false,
  omitActor,
  className,
}: {
  event: JournalEvent;
  compact?: boolean;
  /** Hides this actor's chip, e.g. in the inspector for that same character. */
  omitActor?: string;
  className?: string;
}) {
  const kind = kindOf(event);
  const Icon = kind.icon;
  const actors = (kind.actors?.(event) ?? event.actors).filter(
    (id) => id !== omitActor,
  );
  const thought = kind.thought?.(event);
  const target = kind.target?.(event);
  const link = target && "view" in target ? target : undefined;

  return (
    <article
      className={cn("flex gap-3 px-3 py-2", className)}
      aria-label={`${kind.label} at ${formatSimTime(event.simTime)}`}
    >
      <time className="w-11 shrink-0 pt-1 font-mono text-xs text-muted-foreground tabular-nums">
        {formatSimTime(event.simTime)}
      </time>
      <Icon
        aria-label={kind.label}
        className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Inline flow, not flex-wrap, so chips and fact text read as one sentence when they wrap. */}
        <p className="min-w-0 text-sm leading-relaxed text-pretty">
          {actors.slice(0, MAX_CHIPS).map((id, index) => (
            <CharacterChip
              key={id}
              id={id}
              className={index === 0 ? "mr-1 -ml-1" : "mr-1"}
            />
          ))}
          {actors.length > MAX_CHIPS ? (
            <span className="mr-1 font-mono text-xs text-muted-foreground">{`+${actors.length - MAX_CHIPS}`}</span>
          ) : null}
          {kind.fact(event)}
        </p>
        {thought && !compact ? (
          <ThoughtAttribution by={thought.by} text={thought.text} />
        ) : null}
      </div>
      {link && event.chatId && !compact ? (
        <ChatLink link={link} chatId={event.chatId} />
      ) : null}
    </article>
  );
});
