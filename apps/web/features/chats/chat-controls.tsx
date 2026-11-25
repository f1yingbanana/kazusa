"use client";

import {
  CheckIcon,
  LogInIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useBridges } from "@/hooks/use-bridges";
import { useCastPicks } from "@/hooks/use-cast-picks";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions } from "@/hooks/use-chats";
import { useOccupancy } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { andList } from "@/lib/format";
import { setChatSettings } from "@/lib/source/chats/http";
import type { Chat } from "@/lib/source/chats/types";
import { Button, buttonClass, IconButton } from "@/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertPanel } from "@/ui/dialog";
import { TextInput } from "@/ui/input";
import { PickList, type PickGroup } from "@/ui/pick-list";
import {
  Popover,
  PopoverContent,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { SwitchRow } from "@/ui/switch";
import { CharacterAvatar } from "../characters/character-avatar";
import { conversationParsers } from "./open";

function failed(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : undefined,
  });
}

/** What being alone in a conversation says, wherever it's said. */
export function aloneCopy(
  chat: Pick<Chat, "type">,
  canAdd: boolean,
): { title: string; body: string } {
  const inPerson = chat.type === "huddle";
  return {
    title: inPerson ? "Nobody else is around" : "It's just you in here",
    body: canAdd
      ? inPerson
        ? "Call someone over to start talking."
        : "Messages wait until someone joins. Add people to get it going."
      : "No one else is here yet.",
  };
}

/** A group's title, with a pencil that turns it into a field. */
export function RenameTitle({
  chat,
  title,
  className,
}: {
  chat: Chat | undefined;
  title: string;
  className: string;
}) {
  const { manage } = useChatActions();
  const { canPlay } = useAccess();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renamable = canPlay && chat?.type === "group" && !chat.draft;

  if (!renamable || draft === null)
    return (
      <div className="group/title flex min-w-0 items-center gap-1">
        <h2 className={className}>{title}</h2>
        {renamable ? (
          <IconButton
            label="Rename group"
            size="sm"
            className="opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => setDraft(title)}
          >
            <PencilIcon aria-hidden />
          </IconButton>
        ) : null}
      </div>
    );

  const next = draft.trim();
  async function save() {
    if (!chat || !next || next === title) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await manage({
        sessionKey: chat.sessionKey,
        action: "rename",
        title: next,
      });
      setDraft(null);
    } catch (error) {
      failed("Couldn't rename the group", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextInput
        aria-label="Group name"
        value={draft}
        autoFocus
        disabled={saving}
        className="h-9 flex-1 font-bold"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Cancels the rename only, not the drawer the panel may be in.
          event.stopPropagation();
          setDraft(null);
        }}
      />
      <IconButton
        label="Save name"
        size="sm"
        type="submit"
        disabled={saving || !next}
      >
        <CheckIcon aria-hidden />
      </IconButton>
      <IconButton
        label="Cancel"
        size="sm"
        disabled={saving}
        onClick={() => setDraft(null)}
      >
        <XIcon aria-hidden />
      </IconButton>
    </form>
  );
}

/**
 * Who can be brought in: anyone for a group, onstage first; face to face, those
 * standing at the place (someone talking with others there would have to be
 * walked over to, so they show but can't be picked).
 */
function useCandidates(chat: Chat): readonly PickGroup[] {
  const { characters, byId } = useCharacters();
  const agentIds = useMemo(
    () => characters.filter((c) => c.kind === "agent").map((c) => c.id),
    [characters],
  );
  const occupied = useOccupancy(agentIds);
  const { chats: observed } = useObservedChats();
  const cast = useCastPicks(chat.members);

  return useMemo(() => {
    const face = (id: string, name: string, avatarUrl?: string) => (
      <CharacterAvatar
        id={id}
        name={name}
        avatarUrl={avatarUrl}
        kind="agent"
        size="sm"
        decorative
      />
    );
    if (chat.type !== "huddle") {
      const item = (one: (typeof cast)[number]) => ({
        value: one.id,
        label: one.name,
        keywords: one.aliases,
        media: face(one.id, one.name, one.avatarUrl),
        muted: one.offstage,
        ...(one.offstage ? { sub: "Offstage: won't reply right away" } : {}),
      });
      return [
        { label: "Onstage", items: cast.filter((c) => !c.offstage).map(item) },
        { label: "Offstage", items: cast.filter((c) => c.offstage).map(item) },
      ].filter((group) => group.items.length > 0);
    }
    const talking = new Map<string, readonly string[]>();
    for (const other of observed) {
      if (
        other.type !== "huddle" ||
        other.placeId !== chat.placeId ||
        other.ended
      )
        continue;
      for (const id of other.members) talking.set(id, other.members);
    }
    const here = chat.placeId ? (occupied.at.get(chat.placeId) ?? []) : [];
    const items = here
      .filter((id) => !chat.members.includes(id))
      .map((id) => {
        const character = byId.get(id);
        const name = character?.name ?? id;
        const with_ = (talking.get(id) ?? [])
          .filter((member) => member !== id)
          .map((member) => byId.get(member)?.name ?? member);
        return {
          value: id,
          label: name,
          media: face(id, name, character?.avatarUrl),
          ...(talking.has(id)
            ? { sub: `Talking with ${andList(with_)}`, disabled: true }
            : {}),
        };
      })
      .sort(
        (a, b) =>
          Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)) ||
          a.label.localeCompare(b.label),
      );
    return items.length ? [{ label: "Here", items }] : [];
  }, [chat, cast, occupied, observed, byId]);
}

/**
 * Pick any number of people and bring them in at once: added to a group, or
 * called over, aloud, to a talk face to face.
 */
export function AddPeople({
  chat,
  placeName,
  size = "sm",
}: {
  chat: Chat;
  placeName?: string;
  size?: "sm" | "md";
}) {
  const { manage, callOver } = useChatActions();
  const [, setParams] = useQueryStates(conversationParsers);
  const groups = useCandidates(chat);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const inPerson = chat.type === "huddle";
  const offered = new Map(
    groups.flatMap((g) =>
      g.items.filter((i) => !i.disabled).map((i) => [i.value, i.label]),
    ),
  );
  const chosen = picked.filter((id) => offered.has(id));
  const names = chosen.map((id) => offered.get(id) ?? id);
  const count = groups.reduce((sum, g) => sum + g.items.length, 0);

  async function add() {
    setAdding(true);
    try {
      if (inPerson) {
        const response = await callOver(
          chat,
          chosen,
          `waves ${andList(names)} over`,
        );
        // Someone already talking with others means walking over to them.
        if (response.chatId !== chat.id) {
          toast.info(`You joined ${andList(names)}'s conversation`);
          void setParams({ view: "world", "world.talk": response.chatId });
        } else toast.success(`Called ${andList(names)} over`);
      } else {
        await manage({
          sessionKey: chat.sessionKey,
          action: "add_members",
          members: chosen,
        });
        toast.success(`Added ${andList(names)}`);
      }
      setPicked([]);
      setOpen(false);
    } catch (error) {
      failed(inPerson ? "Couldn't call them over" : "Couldn't add them", error);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked([]);
      }}
    >
      <PopoverTrigger className={buttonClass({ size, tone: "soft" })}>
        <UserPlusIcon aria-hidden />
        {inPerson ? "Call over" : "Add people"}
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
        <PopoverTitle>
          {inPerson ? "Call people over" : "Add people"}
        </PopoverTitle>
        {count === 0 ? (
          <PopoverText>
            {inPerson
              ? `Nobody else is ${placeName ? `at ${placeName}` : "here"} to call over.`
              : "Everyone is in it already."}
          </PopoverText>
        ) : (
          <>
            <PickList
              label="People"
              groups={groups}
              value={picked}
              onValueChange={setPicked}
              placeholder={
                inPerson ? `Find among ${count} here` : `Find among ${count}`
              }
              autoFocus
              className="h-80"
            />
            <div className="flex items-center gap-2 border-t border-ui-line pt-2.5">
              <p className="min-w-0 flex-1 text-xs text-ui-soft">
                {inPerson
                  ? "They hear you call them over."
                  : "They see messages from now on."}
              </p>
              <Button
                tone="primary"
                size="sm"
                disabled={chosen.length === 0}
                pending={adding}
                onClick={() => void add()}
              >
                Confirm
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Take someone out of a group the player is in, after asking. */
export function RemoveMember({
  chat,
  id,
  name,
}: {
  chat: Chat;
  id: string;
  name: string;
}) {
  const { manage } = useChatActions();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        aria-label={`Remove ${name}`}
        className={buttonClass({
          tone: "ghost",
          size: "sm",
          className:
            "w-7.5 px-0 opacity-0 group-hover/member:opacity-100 hover:text-ui-danger focus-visible:opacity-100 pointer-coarse:opacity-100",
        })}
      >
        <UserMinusIcon aria-hidden />
      </AlertDialogTrigger>
      <AlertPanel
        title={`Remove ${name}?`}
        description="Everyone in the chat sees it, and they stop getting its messages."
        danger
        agentConfirm={`Removes ${name} from the group`}
        onConfirm={() =>
          void manage({
            sessionKey: chat.sessionKey,
            action: "remove_members",
            members: [id],
          }).then(
            () => toast.success(`Removed ${name}`),
            (error: unknown) => failed(`Couldn't remove ${name}`, error),
          )
        }
      />
    </AlertDialog>
  );
}

/** Leave a group, or a talk face to face (you stay where you are). */
export function LeaveChat({
  chat,
  title,
  placeName,
  open,
  onOpenChange,
}: {
  chat: Chat;
  title: string;
  placeName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { manage } = useChatActions();
  const inPerson = chat.type === "huddle";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertPanel
        title={inPerson ? "Leave the conversation?" : `Leave ${title}?`}
        description={
          inPerson
            ? `You stay ${placeName ? `at ${placeName}` : "where you are"} and the others carry on without you. Say something to them to join again.`
            : chat.joinable
              ? "Everyone in it sees that you left. It's open, so you can join again."
              : "Everyone in it sees that you left. You can still read it, but you can't write in it unless someone adds you back."
        }
        danger
        agentConfirm={`Leaves ${title}`}
        onConfirm={() =>
          void manage({ sessionKey: chat.sessionKey, action: "leave" }).then(
            () =>
              toast.success(
                inPerson ? "You left the conversation" : `You left ${title}`,
              ),
            (error: unknown) =>
              failed(
                `Couldn't leave the ${inPerson ? "conversation" : "group"}`,
                error,
              ),
          )
        }
      />
    </AlertDialog>
  );
}

/** Join an open group the player isn't in; everyone in it sees them come in. */
export function JoinGroup({ id, title }: { id: string; title: string }) {
  const { manage } = useChatActions();
  const [joining, setJoining] = useState(false);
  async function join() {
    setJoining(true);
    try {
      // Anyone's address for a group: the shorthand, from its id.
      await manage({
        sessionKey: `chat:group:${id.slice("group:".length)}`,
        action: "join",
      });
      toast.success(`You joined ${title}`);
    } catch (error) {
      failed("Couldn't join the group", error);
    } finally {
      setJoining(false);
    }
  }
  return (
    <Button
      tone="primary"
      icon={<LogInIcon aria-hidden />}
      disabled={joining}
      onClick={() => void join()}
    >
      Join group
    </Button>
  );
}

/**
 * The owner opens a group so anyone can join it by its address, as people do a
 * server channel, or closes it; those already in it stay.
 */
export function OpenToJoin({
  id,
  joinable,
}: {
  id: string;
  joinable: boolean;
}) {
  const { refreshChats } = useChatActions();
  const { reload } = useObservedChats();
  const [saving, setSaving] = useState(false);
  async function change(next: boolean) {
    setSaving(true);
    try {
      await setChatSettings({ chatId: id, joinable: next });
      await Promise.all([refreshChats(), reload()]);
    } catch (error) {
      failed("Couldn't change who can join", error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <SwitchRow
      label="Open to join"
      hint="Characters and people can come in by themselves, as into a server channel."
      checked={joinable}
      disabled={saving}
      onCheckedChange={(next) => void change(next)}
    />
  );
}

/**
 * The owner links a group or a direct chat to a Discord channel by its ID: the
 * chat's lines show there, linked accounts speak there as whoever they play,
 * and in a group anyone else is a guest.
 */
export function DiscordChannel({
  id,
  direct = false,
}: {
  id: string;
  direct?: boolean;
}) {
  const { data, link } = useBridges();
  const entry = data?.links.find((l) => l.chatId === id);
  const linked = entry?.channelId;
  const [edit, setEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = edit ?? linked ?? "";
  const next = value.trim() || null;
  // Linked and untouched, or emptied: the button takes it off Discord.
  const unlinking = Boolean(linked) && (edit === null || next === null);
  if (!data) return null;
  const connected = data.discord.status.state === "connected";

  async function save(channelId: string | null) {
    setSaving(true);
    try {
      await link(id, channelId);
      setEdit(null);
      toast.success(channelId ? "Linked to Discord" : "Unlinked from Discord");
    } catch (error) {
      failed("Couldn't change the Discord link", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-1.5 rounded-[1rem] bg-ui-tint px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(unlinking ? null : next);
      }}
    >
      <label htmlFor={`discord-${id}`} className="text-sm font-bold">
        Discord channel
      </label>
      <div className="flex items-center gap-1.5">
        <TextInput
          id={`discord-${id}`}
          inputMode="numeric"
          placeholder="Paste a channel ID"
          value={value}
          disabled={!connected && !linked}
          className="h-9 flex-1 bg-ui-surface tabular-nums"
          onChange={(event) => setEdit(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          tone={unlinking ? "danger" : "primary"}
          disabled={!unlinking && next === (linked ?? null)}
          pending={saving}
        >
          {unlinking ? "Unlink" : "Link"}
        </Button>
      </div>
      {entry?.problem ? (
        <span role="alert" className="text-xs text-pretty text-ui-danger">
          {entry.problem}
        </span>
      ) : entry?.channelName && edit === null ? (
        <span className="text-xs text-pretty text-ui-soft">
          {"Linked to "}
          <span className="font-bold text-ui-ink">#{entry.channelName}</span>
          {entry.server ? ` in ${entry.server}` : null}
        </span>
      ) : (
        <span className="text-xs text-pretty text-ui-soft">
          {connected
            ? direct
              ? "Its lines show there, and your linked account speaks there as whoever you play."
              : "Its lines show there, and people writing there join in as guests."
            : "Connect a Discord bot in Settings, Chat apps, first."}
        </span>
      )}
    </form>
  );
}
