"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  EllipsisIcon,
  EyeIcon,
  LogOutIcon,
  MessagesSquareIcon,
  SpeechIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useBridges } from "@/hooks/use-bridges";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { usePlace } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { useSelfIn } from "@/hooks/use-self";
import { listNames } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import { Button, IconButton } from "@/ui/button";
import {
  Detail,
  DetailActions,
  DetailActionsEnd,
  DetailHeader,
  DetailMark,
  DetailSection,
} from "@/ui/detail";
import { EmptySeats } from "@/ui/empty-seats";
import { Fold, Folds } from "@/ui/fold";
import { ListRow } from "@/ui/list";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/ui/menu";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { usePresence, PRESENCE_TEXT } from "../characters/presence";
import { chatIcon, useChatTitle } from "../legacy";
import {
  AddPeople,
  aloneCopy,
  DiscordChannel,
  JoinGroup,
  LeaveChat,
  OpenToJoin,
  RemoveMember,
  RenameTitle,
} from "./chat-controls";
import { conversationParsers } from "./open";

const TYPE_LABEL = {
  direct: "Direct message",
  group: "Group chat",
  huddle: "In person",
} as const;

const TITLE = "text-[1.0625rem] leading-tight font-extrabold text-balance";

/**
 * Laid out like a person or a place: what it is and what you can do with it
 * (leaving under More), who is in it, then the owner's sharing settings folded
 * away.
 */
export function ChatDetail({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const [query, setParams] = useQueryStates(conversationParsers);
  const [, select] = useSelection();
  const { byId } = useCharacters();
  const { chats } = useChats();
  const selfOf = useSelfIn();
  const {
    title,
    type,
    mine,
    readable,
    ended,
    draft,
    placeId,
    joinable,
    members: everyone,
  } = useChatTitle(id);
  const place = usePlace(placeId);
  const { canPlay, canManage } = useAccess();
  const { watching } = useSources();
  const bridges = useBridges();
  const [leaving, setLeaving] = useState(false);

  const self = selfOf({ members: everyone });
  const members = everyone.filter((m) => m !== self);
  const Icon = chatIcon(type);
  const own = chats.find((chat) => chat.id === id);
  const runsGroup = canPlay && own?.type === "group";
  const canAdd =
    Boolean(own) && canPlay && (runsGroup || own?.type === "huddle");
  const canLeave = canPlay && (own?.type === "group" || own?.type === "huddle");
  const canJoin =
    canPlay && !watching && !own && readable && type === "group" && !!joinable;
  const huddle = type === "huddle";
  const isOpen = huddle
    ? query.view === "world" && query["world.talk"] === id
    : query.view === "chats" && query["chats.id"] === id;
  const sharing =
    readable && !draft && type !== "huddle" && (canManage || bridges.enabled);

  const names = members.map((m) => byId.get(m)?.name ?? m);
  const meta = [
    TYPE_LABEL[type],
    draft
      ? "starts when you send a message"
      : !mine
        ? ended
          ? "ended"
          : "you're watching"
        : type !== "direct"
          ? names.length === 0
            ? "just you"
            : `you and ${names.length <= 2 ? listNames(names) : `${names.length} others`}`
          : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const alone = aloneCopy({ type }, canAdd);

  return (
    <Detail label={title}>
      <DetailHeader
        media={
          <DetailMark>
            <Icon />
          </DetailMark>
        }
        title={<RenameTitle chat={own} title={title} className={TITLE} />}
        subtitle={
          <>
            {meta}
            {huddle && place ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="font-bold text-ui-primary hover:underline hover:underline-offset-3"
                  onClick={() => void select({ kind: "place", id: place.id })}
                >
                  {place.name}
                </button>
              </>
            ) : null}
          </>
        }
        onClose={onClose}
      />

      {!readable ? (
        <Note inset="panel">{"Reading this chat isn't available."}</Note>
      ) : canJoin || !isOpen || (own && canLeave) ? (
        <DetailActions label={`Actions for ${title}`}>
          {canJoin ? <JoinGroup id={id} title={title} /> : null}
          {!isOpen ? (
            <Button
              tone={canJoin ? "soft" : "primary"}
              icon={
                mine ? (
                  huddle ? (
                    <SpeechIcon aria-hidden />
                  ) : (
                    <MessagesSquareIcon aria-hidden />
                  )
                ) : (
                  <EyeIcon aria-hidden />
                )
              }
              onClick={() =>
                void setParams({
                  view: huddle ? "world" : "chats",
                  "chats.id": huddle ? null : id,
                  "world.talk": huddle ? id : null,
                })
              }
            >
              {huddle
                ? mine
                  ? "Join the talk"
                  : "Listen in"
                : mine
                  ? "Open chat"
                  : "Read along"}
            </Button>
          ) : null}
          {own && canLeave ? (
            <DetailActionsEnd>
              <Menu>
                <MenuTrigger
                  render={
                    <IconButton
                      label={`More for ${title}`}
                      title="More"
                      tone="soft"
                      size="md"
                    />
                  }
                >
                  <EllipsisIcon aria-hidden />
                </MenuTrigger>
                <MenuContent>
                  <MenuItem
                    danger
                    icon={<LogOutIcon aria-hidden />}
                    onSelect={() => setLeaving(true)}
                  >
                    Leave
                  </MenuItem>
                </MenuContent>
              </Menu>
              <LeaveChat
                chat={own}
                title={title}
                placeName={place?.name}
                open={leaving}
                onOpenChange={setLeaving}
              />
            </DetailActionsEnd>
          ) : null}
        </DetailActions>
      ) : null}

      {type !== "direct" ? (
        <DetailSection
          title="People"
          meta={members.length || undefined}
          action={
            own && canAdd ? (
              <AddPeople chat={own} placeName={place?.name} />
            ) : undefined
          }
        >
          {members.length === 0 && !draft ? (
            <EmptySeats slim title={mine ? alone.title : "No one's here"}>
              {mine ? alone.body : "Everyone has left."}
            </EmptySeats>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {members.map((m) => {
                const character = byId.get(m);
                return (
                  <li
                    key={m}
                    className="group/member flex items-center gap-1 pe-2"
                  >
                    <div className="min-w-0 flex-1">
                      {character ? (
                        <MemberRow
                          character={character}
                          onPick={() =>
                            void select({ kind: "character", id: character.id })
                          }
                        />
                      ) : (
                        <ListRow
                          onClick={() => {}}
                          title={m.startsWith("guest:") ? "Guest" : m}
                        />
                      )}
                    </div>
                    {runsGroup && own ? (
                      <RemoveMember
                        chat={own}
                        id={m}
                        name={character?.name ?? m}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DetailSection>
      ) : null}

      {sharing ? (
        <Folds>
          <Fold
            value="sharing"
            title="Sharing"
            summary={
              [
                joinable ? "Open to join" : null,
                bridges.data?.links.some((l) => l.chatId === id)
                  ? "On Discord"
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Private"
            }
          >
            <div className="flex flex-col gap-2">
              {canManage && type === "group" ? (
                <OpenToJoin id={id} joinable={!!joinable} />
              ) : null}
              <DiscordChannel id={id} direct={type === "direct"} />
            </div>
          </Fold>
        </Folds>
      ) : null}
    </Detail>
  );
}

/** Someone in the chat: their face and what they're up to. */
function MemberRow({
  character,
  onPick,
}: {
  character: CharacterSummary;
  onPick: () => void;
}) {
  const { status, presence } = usePresence(character);
  const sub =
    status?.task?.description ?? (PRESENCE_TEXT[presence] || undefined);
  return (
    <ListRow
      onClick={onPick}
      leading={
        <CharacterAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="sm"
          decorative
        />
      }
      title={character.name}
      sub={sub}
    />
  );
}
