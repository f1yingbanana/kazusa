"use client";

import { EyeIcon, LogInIcon, MessagesSquareIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions, useChats } from "@/hooks/use-chats";
import { usePlace } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useSelection } from "@/hooks/use-selection";
import { useSelfIn } from "@/hooks/use-self";
import { listNames } from "@/lib/source/chats/display";
import { setChatSettings } from "@/lib/source/chats/http";
import { useSources } from "@/lib/source/provider";
import { useWatchlist } from "@/lib/state/preferences-store";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import {
  Detail,
  DetailActions,
  DetailActionsEnd,
  DetailHeader,
  DetailMark,
  DetailSubhead,
} from "@/ui/detail";
import { EmptySeats } from "@/ui/empty-seats";
import { Note } from "@/ui/note";
import { SwitchRow } from "@/ui/switch";
import {
  AddPeople,
  CharacterChip,
  CharacterRow,
  ChatTitle,
  chatIcon,
  chatsParsers,
  LeaveChat,
  RemoveButton,
  RemoveConfirm,
  useChatTitle,
} from "../legacy";

/* The old leave, add and rename controls, in this panel's button voice. */
const LEGACY =
  "[&_[data-slot=button]]:h-9 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:border-0 [&_[data-slot=button]]:bg-ui-tint [&_[data-slot=button]]:px-3.5 [&_[data-slot=button]]:text-sm [&_[data-slot=button]]:font-bold [&_[data-slot=button]]:text-ui-ink [&_[data-slot=button]]:shadow-none [&_[data-slot=button]:hover]:bg-[color-mix(in_oklch,var(--ui-tint),var(--ui-ink)_8%)]";
const LEGACY_SMALL =
  "[&_[data-slot=button]]:h-7.5 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:border-0 [&_[data-slot=button]]:bg-ui-tint [&_[data-slot=button]]:px-3 [&_[data-slot=button]]:text-[0.8125rem] [&_[data-slot=button]]:font-bold [&_[data-slot=button]]:text-ui-ink [&_[data-slot=button]]:shadow-none [&_[data-slot=button]:hover]:bg-[color-mix(in_oklch,var(--ui-tint),var(--ui-ink)_8%)]";

const TYPE_LABEL = {
  direct: "Direct message",
  group: "Group chat",
  huddle: "In person",
} as const;

/**
 * Laid out like a person or a place: what it is, what you can do with it (open
 * it, join or leave), who is in it. A group the player runs is renamed from its
 * title and grows or shrinks from its people list.
 */
export function ChatDetail({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const [query, setParams] = useQueryStates({
    view: parseAsString,
    "chats.id": chatsParsers["chats.id"],
  });
  const [, select] = useSelection();
  const { byId } = useCharacters();
  const { chats } = useChats();
  const selfOf = useSelfIn();
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
    joinable,
    members: everyone,
  } = useChatTitle(id);
  const place = usePlace(placeId);
  const { canPlay, canManage } = useAccess();
  const { watching } = useSources();

  const self = selfOf({ members: everyone });
  const members = everyone.filter((m) => m !== self);
  const Icon = chatIcon(type);
  const own = chats.find((chat) => chat.id === id);
  const runsGroup = canPlay && own?.type === "group";
  const canLeave = canPlay && (own?.type === "group" || own?.type === "huddle");
  const canJoin =
    canPlay && !watching && !own && readable && type === "group" && !!joinable;
  const isOpen = query.view === "chats" && query["chats.id"] === id;

  const names = members.map((m) => byId.get(m)?.name ?? m);
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
    <Detail label={title}>
      <DetailHeader
        media={
          <DetailMark>
            <Icon />
          </DetailMark>
        }
        title={
          runsGroup && own ? (
            <span className={LEGACY}>
              <ChatTitle chat={own} title={title} />
            </span>
          ) : (
            title
          )
        }
        subtitle={
          <>
            {meta}
            {type === "huddle" && place ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="font-semibold text-ui-primary hover:underline hover:underline-offset-3"
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
      ) : (
        <DetailActions label={`Actions for ${title}`}>
          {canJoin ? <JoinButton id={id} title={title} /> : null}
          {!isOpen ? (
            <Button
              tone={canJoin ? "soft" : "primary"}
              icon={
                mine ? (
                  <MessagesSquareIcon aria-hidden />
                ) : (
                  <EyeIcon aria-hidden />
                )
              }
              onClick={() => void setParams({ view: "chats", "chats.id": id })}
            >
              {mine ? "Open chat" : "Peek in"}
            </Button>
          ) : null}
          {own && canLeave ? (
            <DetailActionsEnd>
              <span className={LEGACY}>
                <LeaveChat chat={own} title={title} placeName={place?.name} />
              </span>
            </DetailActionsEnd>
          ) : null}
        </DetailActions>
      )}

      {canManage && type === "group" && readable && !draft ? (
        <OpenToJoin id={id} joinable={!!joinable} />
      ) : null}

      <section aria-label="People">
        {type !== "direct" ? (
          <div className={LEGACY_SMALL}>
            <DetailSubhead
              title={
                members.length > 0 ? `People · ${members.length}` : "People"
              }
              action={
                own && canPlay && (runsGroup || own.type === "huddle") ? (
                  <AddPeople chat={own} placeName={place?.name} />
                ) : undefined
              }
            />
          </div>
        ) : null}
        <div className={cx(LEGACY, "-mx-2 flex flex-col")}>
          {members.map((m) => {
            const character = byId.get(m);
            const name = character?.name ?? m;
            if (runsGroup && own && removing === m) {
              return (
                <RemoveConfirm
                  key={m}
                  chat={own}
                  id={m}
                  name={name}
                  onDone={() => setRemoving(null)}
                />
              );
            }
            return character ? (
              <CharacterRow
                key={m}
                character={character}
                selected={false}
                starred={watchSet.has(m)}
                onSelect={(next) =>
                  void select({ kind: "character", id: next })
                }
                action={
                  runsGroup ? (
                    <RemoveButton name={name} onClick={() => setRemoving(m)} />
                  ) : undefined
                }
              />
            ) : (
              <CharacterChip key={m} id={m} className="mx-2 self-start" />
            );
          })}
          {type !== "direct" && members.length === 0 && !draft ? (
            <EmptySeats slim title={mine ? "It's just you" : "No one's here"}>
              {own && canPlay && (runsGroup || own.type === "huddle")
                ? "Add people to get the conversation going."
                : "Everyone has left this chat."}
            </EmptySeats>
          ) : null}
        </div>
      </section>
    </Detail>
  );
}

function JoinButton({ id, title }: { id: string; title: string }) {
  const { manage } = useChatActions();

  async function join() {
    try {
      await manage({
        // Anyone's address for a group: the shorthand, from its id.
        sessionKey: `chat:group:${id.slice("group:".length)}`,
        action: "join",
      });
      toast.success(`You joined ${title}`);
    } catch (error) {
      toast.error("Couldn't join the group", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return (
    <Button
      tone="primary"
      icon={<LogInIcon aria-hidden />}
      pendingAnnouncement="Joining"
      onClick={join}
    >
      Join group
    </Button>
  );
}

/**
 * The owner opens a group so anyone with its address can join; those in it
 * stay.
 */
function OpenToJoin({ id, joinable }: { id: string; joinable: boolean }) {
  const { refreshChats } = useChatActions();
  const { reload } = useObservedChats();
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setSaving(true);
    try {
      await setChatSettings({ chatId: id, joinable: next });
      await Promise.all([refreshChats(), reload()]);
    } catch (error) {
      toast.error("Couldn't change who can join", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SwitchRow
      label="Open to join"
      hint="Anyone with its address can join it themselves."
      checked={joinable}
      disabled={saving}
      onCheckedChange={(next) => void change(next)}
    />
  );
}
