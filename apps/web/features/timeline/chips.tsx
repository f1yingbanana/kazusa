"use client";

import { ArrowUpRightIcon, BookOpenIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useChats } from "@/hooks/use-chats";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { usePageName } from "@/hooks/use-wiki";
import { useDraftChat } from "@/lib/state/chat-draft";
import { Button } from "@/ui/button";
import { conversationParsers, conversationPatch } from "../chats/open";
import { wikiParsers } from "../legacy";

export function WikiPageChip({
  id,
  isNew = false,
}: {
  id: string;
  isNew?: boolean;
}) {
  const pageName = usePageName();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "wiki.page": wikiParsers["wiki.page"],
    "wiki.agent": wikiParsers["wiki.agent"],
    "wiki.part": wikiParsers["wiki.part"],
    "wiki.edit": wikiParsers["wiki.edit"],
    "wiki.raw": wikiParsers["wiki.raw"],
  });
  return (
    <button
      type="button"
      className="inline-flex max-w-48 min-w-0 items-center gap-1 rounded-full bg-ui-surface px-2 py-0.5 text-xs font-bold text-ui-ink inset-ring inset-ring-ui-line transition-colors duration-150 hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-primary"
      onClick={() =>
        void setParams({
          view: "wiki",
          "wiki.page": id,
          "wiki.agent": null,
          "wiki.part": null,
          "wiki.edit": null,
          "wiki.raw": null,
        })
      }
    >
      <BookOpenIcon aria-hidden className="size-3 shrink-0 text-ui-soft" />
      <span className="truncate">{pageName(id)}</span>
      {isNew ? (
        <span className="rounded-full bg-ui-accent px-1.5 py-px text-[0.625rem] font-extrabold text-ui-on-accent uppercase">
          new
        </span>
      ) : null}
    </button>
  );
}

/** Routes huddles to World and text chats to Chats using conversationPatch. */
export function OpenConversationButton({
  chatId,
  messageId,
}: {
  chatId: string;
  messageId?: string;
}) {
  const { chats } = useChats();
  const draft = useDraftChat();
  const selfOf = useSelfIn();
  const { chat: observed } = useObservedChat(
    chats.some((c) => c.id === chatId) ? null : chatId,
  );
  const [, setParams] = useQueryStates({
    ...conversationParsers,
    "chats.msg": parseAsString,
  });

  const target =
    chats.find((c) => c.id === chatId) ??
    (draft?.id === chatId ? draft : undefined) ??
    observed;
  if (!target) return null;

  const mine = chats.some((c) => c.id === chatId) || draft?.id === chatId;
  const huddle = target.type === "huddle";
  const label = huddle
    ? mine
      ? "Open talk"
      : "Listen in"
    : mine
      ? "Open chat"
      : "Peek chat";

  return (
    <Button
      tone="ghost"
      size="sm"
      onClick={() => {
        const patch = conversationPatch(target, mine ? selfOf(target) : "");
        void setParams({
          ...patch,
          "chats.msg": !huddle && messageId ? messageId : null,
        });
      }}
    >
      <span className="inline-flex items-center gap-1">
        <span>{label}</span>
        <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
      </span>
    </Button>
  );
}
