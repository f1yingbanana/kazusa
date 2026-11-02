"use client";

import { EyeIcon, MessagesSquareIcon } from "lucide-react";
import { CharacterRow } from "@/components/entities/character-row";
import {
  CharacterChip,
  PlaceChip,
  chatIcon,
  useChatTitle,
} from "@/components/entities/chips";
import { NeedsLine } from "@/components/entities/source-state";
import { Button } from "@/components/ui/button";
import { useCharacters } from "@/hooks/use-characters";
import { useNavigate, useParam, useSelection } from "@/hooks/use-url-state";
import { useKazusaConfig } from "@/lib/state/config-store";
import { useWatchlist } from "@/lib/state/watchlist";
import type { EntityRef } from "@/lib/state/entity-ref";

const TYPE_LABEL = {
  direct: "Direct message",
  group: "Group chat",
  huddle: "In person",
} as const;

/** Who is in the conversation and what each is doing; a huddle also says where. */
export function ChatSummarySection({ entity }: { entity: EntityRef }) {
  const navigate = useNavigate();
  const [, select] = useSelection();
  const view = useParam("view");
  const chatParam = useParam("chats.id");
  const isOpen = view === "chats" && chatParam === entity.id;
  const { byId } = useCharacters();
  const config = useKazusaConfig();
  const watchSet = new Set(useWatchlist());
  const {
    title,
    type,
    mine,
    readable,
    ended,
    placeId,
    members: everyone,
  } = useChatTitle(entity.id);
  const members = everyone.filter((id) => id !== config.userId);
  const Icon = chatIcon(type);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className="mt-1 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-base leading-tight font-semibold">
            {title}
          </h2>
          <p className="-ml-1 flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            <span className="pl-1">{TYPE_LABEL[type]}</span>
            {placeId ? (
              <>
                <span>at</span>
                <PlaceChip id={placeId} bare />
              </>
            ) : null}
            {mine ? null : <span>{ended ? "· ended" : "· observed"}</span>}
          </p>
        </div>
      </div>
      <div className="-mx-2 flex flex-col">
        {members.map((id) => {
          const character = byId.get(id);
          return character ? (
            <CharacterRow
              key={id}
              character={character}
              selected={false}
              starred={watchSet.has(id)}
              onSelect={(next) => select({ kind: "character", id: next })}
            />
          ) : (
            <CharacterChip key={id} id={id} className="mx-2 self-start" />
          );
        })}
      </div>
      {!readable ? (
        <NeedsLine requires={["observe"]}>
          Reading this chat isn&apos;t available.
        </NeedsLine>
      ) : !isOpen ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => navigate({ view: "chats", "chats.id": entity.id })}
        >
          {mine ? (
            <MessagesSquareIcon data-icon="inline-start" />
          ) : (
            <EyeIcon data-icon="inline-start" />
          )}
          {mine ? "Open in Chats" : "Peek at this chat"}
        </Button>
      ) : null}
    </div>
  );
}
