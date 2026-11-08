"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useState } from "react";
import { EyeIcon, MessagesSquareIcon } from "lucide-react";
import { CharacterRow } from "@/components/entities/character-row";
import {
  CharacterChip,
  chatIcon,
  useChatTitle,
} from "@/components/entities/chips";
import { NeedsLine } from "@/components/entities/source-state";
import { Button } from "@/components/ui/button";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlace } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { useSelection } from "@/hooks/use-selection";
import { listNames } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import { useWatchlist } from "@/lib/state/preferences-store";
import type { EntityRef } from "@/lib/state/entity-ref";
import {
  AddPeople,
  ChatTitle,
  LeaveChat,
  RemoveButton,
  RemoveConfirm,
} from "./chat-controls";

const TYPE_LABEL = {
  direct: "Direct message",
  group: "Group chat",
  huddle: "In person",
} as const;

/**
 * Who is in the conversation and what each is doing; a huddle's title links
 * where it is happening. A group the player is in is run from here: rename it,
 * add or remove people, or leave.
 */
export function ChatSummarySection({ entity }: { entity: EntityRef }) {
  const [queryState, setParams] = useQueryStates({
    view: parseAsString,
    "chats.id": chatsParsers["chats.id"],
  });
  const [, select] = useSelection();
  const view = queryState["view"];
  const chatParam = queryState["chats.id"];
  const isOpen = view === "chats" && chatParam === entity.id;
  const { byId } = useCharacters();
  const { chats } = useChats();
  const { player } = useSources();
  const watchSet = new Set(useWatchlist());
  const [removing, setRemoving] = useState<string | null>(null);
  const {
    title,
    type,
    mine,
    readable,
    ended,
    draft,
    placeId,
    members: everyone,
  } = useChatTitle(entity.id);
  const place = usePlace(placeId);
  const members = everyone.filter((id) => id !== player.id);
  const Icon = chatIcon(type);

  // Only a sent chat the player is in can be changed.
  const { canPlay } = useAccess();
  const own = chats.find((chat) => chat.id === entity.id);
  const runsGroup = canPlay && own?.type === "group";
  const canLeave = canPlay && (own?.type === "group" || own?.type === "huddle");
  const showOpen = readable && !isOpen;
  const showPlace = () => {
    if (placeId) void select({ kind: "place", id: placeId });
  };

  // One plain line: what kind of chat, then who or what state it is in.
  const names = members.map((id) => byId.get(id)?.name ?? id);
  const who =
    names.length === 0
      ? "just you"
      : names.length <= 2
        ? `you and ${listNames(names)}`
        : `you and ${names.length} others`;
  const meta = [
    TYPE_LABEL[type],
    draft
      ? "starts when you send a message"
      : !mine
        ? ended
          ? "ended"
          : "observed"
        : type !== "direct"
          ? who
          : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 pr-8">
        <Icon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ChatTitle chat={own} title={title}>
            {type === "huddle" && place ? (
              // One span: line-clamp makes each direct child a block.
              <span>
                {ended ? "Talked at " : "Talking at "}
                {/* A button is always laid out as a box; this wraps with the text. */}
                <span
                  role="button"
                  tabIndex={0}
                  title={place.summary}
                  onClick={showPlace}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    showPlace();
                  }}
                  className="cursor-pointer rounded-sm underline decoration-muted-foreground/40 underline-offset-[3px] outline-none hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {place.name}
                </span>
              </span>
            ) : undefined}
          </ChatTitle>
          <p className="text-sm leading-snug text-muted-foreground">{meta}</p>
          {!readable ? (
            <NeedsLine requires={["observe"]}>
              Reading this chat isn&apos;t available.
            </NeedsLine>
          ) : showOpen || (own && canLeave) ? (
            <div className="-ml-1.5 mt-1.5 flex flex-wrap items-center gap-1.5">
              {showOpen ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void setParams({ view: "chats", "chats.id": entity.id })
                  }
                >
                  {mine ? (
                    <MessagesSquareIcon data-icon="inline-start" />
                  ) : (
                    <EyeIcon data-icon="inline-start" />
                  )}
                  {mine ? "Open in Chats" : "Peek at this chat"}
                </Button>
              ) : null}
              {own && canLeave ? (
                <LeaveChat chat={own} title={title} placeName={place?.name} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {type !== "direct" ? (
          <div className="flex h-6 items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {members.length > 0 ? `People · ${members.length}` : "People"}
            </h3>
            {own && canPlay && (runsGroup || own.type === "huddle") ? (
              <AddPeople chat={own} placeName={place?.name} />
            ) : null}
          </div>
        ) : null}
        <div className="-mx-2 flex flex-col">
          {members.map((id) => {
            const character = byId.get(id);
            const name = character?.name ?? id;
            if (runsGroup && removing === id) {
              return (
                <RemoveConfirm
                  key={id}
                  chat={own}
                  id={id}
                  name={name}
                  onDone={() => setRemoving(null)}
                />
              );
            }
            return character ? (
              <CharacterRow
                key={id}
                character={character}
                selected={false}
                starred={watchSet.has(id)}
                onSelect={(next) =>
                  void select({ kind: "character", id: next })
                }
                action={
                  runsGroup ? (
                    <RemoveButton name={name} onClick={() => setRemoving(id)} />
                  ) : undefined
                }
              />
            ) : (
              <CharacterChip key={id} id={id} className="mx-2 self-start" />
            );
          })}
          {runsGroup && members.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Just you. Add people to talk to.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
