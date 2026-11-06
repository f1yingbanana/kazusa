"use client";

import { useMemo, useRef, useState } from "react";
import { SquarePenIcon, UnplugIcon, XIcon } from "lucide-react";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { NeedsLine } from "@/components/entities/source-state";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useNavigate, useParam } from "@/hooks/use-url-state";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { setDraftChat } from "@/lib/state/chat-draft";
import { markQuietSelection } from "@/lib/state/inspector-request";
import { useKazusaConfig } from "@/lib/state/config-store";
import {
  setObservedCollapsed,
  useObservedCollapsed,
} from "@/lib/state/observed-section";
import { ChatList } from "./chat-list";
import { NewGroupDialog } from "./new-group-dialog";
import { ObservedChatList } from "./observed-chat-list";

/**
 * The player's conversations, then everyone else's: the Chats section's
 * sidebar, and the Chats view's first screen on narrow screens. `chats.member`
 * narrows both to one character's chats.
 */
export function ChatsPanel({ onNavigated: onOpened }: SectionSidebarProps) {
  const config = useKazusaConfig();
  const { canPlay } = useAccess();
  const { chats: allMine, error, isLoading, reload } = useChats();
  const observed = useObservedChats();
  const { byId } = useCharacters();
  const navigate = useNavigate();
  const chatId = useParam("chats.id");
  const member = useParam("chats.member");
  const collapsed = useObservedCollapsed();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const chats = useMemo(
    () =>
      member
        ? allMine.filter((chat) => chat.members.includes(member))
        : allMine,
    [allMine, member],
  );
  const normalized = query.trim().toLowerCase();
  const others = useMemo(
    () =>
      observed.chats.filter(
        (chat) =>
          (!member || chat.members.includes(member)) &&
          (!normalized ||
            chat.name.toLowerCase().includes(normalized) ||
            chat.lastMessage?.text.toLowerCase().includes(normalized)),
      ),
    [observed.chats, member, normalized],
  );
  // Whoever is looking for something shouldn't have to unfold it first.
  const othersOpen =
    !collapsed ||
    Boolean(normalized) ||
    Boolean(member) ||
    observed.chats.some((chat) => chat.id === chatId);
  const hasOthers = others.length > 0;
  const total = allMine.length + observed.chats.length;
  const mineMatch =
    !normalized ||
    chats.some(
      (chat) =>
        chat.name.toLowerCase().includes(normalized) ||
        chat.lastMessage?.text.toLowerCase().includes(normalized),
    );
  const memberName = member ? (byId.get(member)?.name ?? member) : null;

  // Opening a chat also points the inspector at it, in the same URL change,
  // including the one already open (after looking at someone else).
  function openChat(chat: ChatInfo) {
    const patch = openChatPatch(chat, config.userId);
    if (patch.sel) markQuietSelection(patch.sel);
    navigate(patch);
    onOpened?.();
  }

  function openChatById(id: string) {
    const chat =
      allMine.find((candidate) => candidate.id === id) ??
      observed.chats.find((candidate) => candidate.id === id);
    if (chat) openChat(chat);
    else navigate({ view: "chats", "chats.id": id });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={total > 0 ? `Search ${total} chats` : "Search chats"}
        label="Search chats"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canPlay}
                onClick={() => setNewGroupOpen(true)}
              />
            }
          >
            <SquarePenIcon />
            <span className="sr-only">New group</span>
          </TooltipTrigger>
          <TooltipContent>New group</TooltipContent>
        </Tooltip>
      </PanelToolbar>

      {memberName ? (
        <div className="flex shrink-0 items-center gap-1 px-4 pb-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{`${memberName}'s chats`}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Show everyone's chats"
            onClick={() => navigate({ "chats.member": null })}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <UnplugIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <p className="flex-1">
            {"Can't reach the Kazusa server, so your chats aren't loaded."}
          </p>
          <Button size="xs" variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <ChatList
            chats={chats}
            agentsById={byId}
            userId={config.userId}
            isLoading={isLoading}
            query={query}
            selectedChatId={chatId}
            onSelect={openChatById}
            onNewGroup={() => setNewGroupOpen(true)}
            quietWhenEmpty={hasOthers || Boolean(memberName)}
          />
          {hasOthers ? (
            <ObservedChatList
              chats={others}
              total={others.length}
              agentsById={byId}
              userId={config.userId}
              selectedChatId={chatId}
              open={othersOpen}
              onToggle={() => setObservedCollapsed(othersOpen)}
              onSelect={openChatById}
              scrollRef={scrollRef}
            />
          ) : null}
          {!isLoading &&
          !hasOthers &&
          (normalized ? !mineMatch : memberName && chats.length === 0) ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {normalized
                ? `No conversations match “${query}”.`
                : `${memberName} isn't in any chats yet.`}
            </p>
          ) : null}
          {!observed.available ? (
            <div className="px-4 pt-2 pb-4">
              <NeedsLine requires={["observe"]}>
                Other characters&apos; chats appear here, read-only.
              </NeedsLine>
            </div>
          ) : observed.error ? (
            <div className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex-1">{"Other characters' chats didn't load."}</p>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void observed.reload()}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreated={(chat) => {
          setDraftChat(chat);
          openChat(chat);
        }}
      />
    </div>
  );
}
