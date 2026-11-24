"use client";

import { useState } from "react";
import { EyeIcon, LogInIcon, MessagesSquareIcon, XIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { CharacterRow } from "@/components/entities/character-row";
import { CharacterChip, chatIcon, useChatTitle } from "@/components/entities/chips";
import {
  AddPeople,
  ChatTitle,
  LeaveChat,
  RemoveButton,
  RemoveConfirm,
} from "@/components/inspector/sections/chat-controls";
import { chatsParsers } from "@/components/views/chats/search-params";
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

const TYPE_LABEL = {
  direct: "Direct message",
  group: "Group chat",
  huddle: "In person",
} as const;

/**
 * A chat, laid out like a person or a place: what it is, what you can do with
 * it (open it, join or leave), who is in it. A group the player runs is
 * renamed from its title and grows or shrinks from its people list.
 */
export function HaloChatSheet({ id, onClose }: { id: string; onClose?: () => void }) {
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
  const { title, type, mine, readable, ended, draft, placeId, joinable, members: everyone } =
    useChatTitle(id);
  const place = usePlace(placeId);
  const { canPlay, canManage } = useAccess();
  const { watching } = useSources();

  const self = selfOf({ members: everyone });
  const members = everyone.filter((m) => m !== self);
  const Icon = chatIcon(type);
  const own = chats.find((chat) => chat.id === id);
  const runsGroup = canPlay && own?.type === "group";
  const canLeave = canPlay && (own?.type === "group" || own?.type === "huddle");
  const canJoin = canPlay && !watching && !own && readable && type === "group" && !!joinable;
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
    <article className="halo-sheet halo-chat-sheet" aria-label={title}>
      <header className="halo-sheet-head">
        <span className="halo-place-mark" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="halo-sheet-title">
          {runsGroup && own ? (
            <div className="halo-sheet-name">
              <ChatTitle chat={own} title={title} />
            </div>
          ) : (
            <h2 className="halo-sheet-name text-balance">{title}</h2>
          )}
          <p className="halo-chat-meta">
            {meta}
            {type === "huddle" && place ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="halo-chat-place"
                  onClick={() => void select({ kind: "place", id: place.id })}
                >
                  {place.name}
                </button>
              </>
            ) : null}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            className="halo-icon-button halo-sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        ) : null}
      </header>

      {!readable ? (
        <p className="halo-panel-empty">{"Reading this chat isn't available."}</p>
      ) : (
        <div className="halo-sheet-actions" role="toolbar" aria-label={`Actions for ${title}`}>
          {canJoin ? <HaloJoin id={id} title={title} /> : null}
          {!isOpen ? (
            <button
              type="button"
              className="halo-action"
              data-primary={canJoin ? undefined : ""}
              onClick={() => void setParams({ view: "chats", "chats.id": id })}
            >
              {mine ? (
                <MessagesSquareIcon aria-hidden className="size-4" />
              ) : (
                <EyeIcon aria-hidden className="size-4" />
              )}
              <span className="truncate">{mine ? "Open chat" : "Peek in"}</span>
            </button>
          ) : null}
          {own && canLeave ? (
            <span className="halo-actions-end">
              <LeaveChat chat={own} title={title} placeName={place?.name} />
            </span>
          ) : null}
        </div>
      )}

      {canManage && type === "group" && readable && !draft ? (
        <HaloOpenToJoin id={id} joinable={!!joinable} />
      ) : null}

      <section className="halo-place-people" aria-label="People">
        {type !== "direct" ? (
          <div className="halo-chat-people-head">
            <h3>{members.length > 0 ? `People · ${members.length}` : "People"}</h3>
            {own && canPlay && (runsGroup || own.type === "huddle") ? (
              <AddPeople chat={own} placeName={place?.name} />
            ) : null}
          </div>
        ) : null}
        <div className="-mx-2 flex flex-col">
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
                onSelect={(next) => void select({ kind: "character", id: next })}
                action={
                  runsGroup ? <RemoveButton name={name} onClick={() => setRemoving(m)} /> : undefined
                }
              />
            ) : (
              <CharacterChip key={m} id={m} className="mx-2 self-start" />
            );
          })}
          {runsGroup && members.length === 0 ? (
            <p className="halo-panel-empty">Just you. Add people to talk to.</p>
          ) : null}
        </div>
      </section>
    </article>
  );
}

function HaloJoin({ id, title }: { id: string; title: string }) {
  const { manage } = useChatActions();
  const [joining, setJoining] = useState(false);

  async function join() {
    setJoining(true);
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
    } finally {
      setJoining(false);
    }
  }

  return (
    <button
      type="button"
      className="halo-action"
      data-primary=""
      disabled={joining}
      onClick={() => void join()}
    >
      <LogInIcon aria-hidden className="size-4" />
      <span className="truncate">{joining ? "Joining…" : "Join group"}</span>
    </button>
  );
}

/** The owner opens a group so anyone with its address can join; those in it stay. */
function HaloOpenToJoin({ id, joinable }: { id: string; joinable: boolean }) {
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
    <div className="halo-setting">
      <span className="halo-setting-text" id={`open-${id}`}>
        <span className="halo-setting-label">Open to join</span>
        <span className="halo-setting-hint">Anyone with its address can join it themselves.</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={joinable}
        aria-labelledby={`open-${id}`}
        className="halo-switch"
        disabled={saving}
        onClick={() => void change(!joinable)}
      />
    </div>
  );
}
