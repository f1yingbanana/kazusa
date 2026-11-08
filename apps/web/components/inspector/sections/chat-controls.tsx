"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useMemo, useState, type ReactNode } from "react";
import {
  CheckIcon,
  LogOutIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions } from "@/hooks/use-chats";
import { useOccupancy } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useOffstage } from "@/hooks/use-stage";
import { useAccess } from "@/hooks/use-access";
import type { Chat } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";

/*
 * The player's own group chats are theirs to run: rename, add, remove, leave.
 * Every change is said in the chat ("adds Airi to the chat"), so the copy
 * says who will see it. A conversation in person grows by calling people
 * over, aloud, and shrinks only by leaving it.
 */

function failed(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : undefined,
  });
}

/** The title, with a pencil that turns it into a field. */
export function ChatTitle({
  chat,
  title,
  children,
}: {
  chat: Chat | undefined;
  title: string;
  /** Shown in place of the plain title (e.g. with the place as a link). */
  children?: ReactNode;
}) {
  const { manage } = useChatActions();
  const { canPlay } = useAccess();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renamable = canPlay && chat?.type === "group" && !chat.draft;

  if (!renamable || draft === null) {
    return (
      <div className="group/title flex min-w-0 items-start gap-1">
        <h2 className="line-clamp-2 text-base leading-snug font-semibold text-pretty">
          {children ?? title}
        </h2>
        {renamable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mt-px text-muted-foreground opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100"
                  onClick={() => setDraft(title)}
                />
              }
            >
              <PencilIcon />
              <span className="sr-only">Rename group</span>
            </TooltipTrigger>
            <TooltipContent>Rename</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  }

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
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Cancels the rename only, not the sheet the inspector may be in.
          event.stopPropagation();
          setDraft(null);
        }}
        aria-label="Group name"
        autoFocus
        className="h-7 min-w-0 flex-1 px-2 text-base font-semibold"
        disabled={saving}
      />
      <Button
        type="submit"
        size="icon-sm"
        variant="ghost"
        disabled={saving || !next}
      >
        {saving ? <Spinner /> : <CheckIcon />}
        <span className="sr-only">Save name</span>
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => setDraft(null)}
        disabled={saving}
      >
        <XIcon />
        <span className="sr-only">Cancel</span>
      </Button>
    </form>
  );
}

/** "Airi", "Airi and Natsu", "Airi, Natsu and Yoshimi": how a line names them. */
function andList(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string;
  /** Why they can't be picked, shown in place of the check. */
  readonly busy?: string;
  readonly offstage?: boolean;
}

/**
 * Who can be brought in: any character for a group; for a conversation in
 * person, those standing at the same place (someone talking with others there
 * would have to be walked over to, not called over, so they are shown but can't
 * be picked).
 */
function useCandidates(chat: Chat): readonly Candidate[] {
  const { characters, byId } = useCharacters();
  const offstage = useOffstage();
  const agentIds = useMemo(
    () => characters.filter((c) => c.kind === "agent").map((c) => c.id),
    [characters],
  );
  const occupied = useOccupancy(agentIds);
  const { chats: observed } = useObservedChats();

  return useMemo(() => {
    const byName = (a: Candidate, b: Candidate) => a.name.localeCompare(b.name);
    if (chat.type !== "huddle") {
      return characters
        .filter((c) => c.kind === "agent" && !chat.members.includes(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          avatarUrl: c.avatarUrl,
          offstage: offstage.has(c.id),
        }))
        .sort(
          (a, b) => Number(a.offstage) - Number(b.offstage) || byName(a, b),
        );
    }
    const talking = new Map<string, readonly string[]>();
    for (const other of observed) {
      if (other.type !== "huddle" || other.placeId !== chat.placeId) continue;
      if (other.ended) continue;
      for (const id of other.members) talking.set(id, other.members);
    }
    const here = chat.placeId ? (occupied.at.get(chat.placeId) ?? []) : [];
    return here
      .filter((id) => !chat.members.includes(id))
      .map((id) => {
        const character = byId.get(id);
        const with_ = (talking.get(id) ?? [])
          .filter((member) => member !== id)
          .map((member) => byId.get(member)?.name ?? member);
        return {
          id,
          name: character?.name ?? id,
          avatarUrl: character?.avatarUrl,
          ...(talking.has(id)
            ? { busy: `Talking with ${andList(with_)}` }
            : {}),
        };
      })
      .sort(
        (a, b) =>
          Number(Boolean(a.busy)) - Number(Boolean(b.busy)) || byName(a, b),
      );
  }, [chat, characters, offstage, occupied, observed, byId]);
}

/**
 * Pick any number of people, then bring them in at once: added to a group, or
 * called over to a conversation in person (they hear it, as everyone there
 * does).
 */
export function AddPeople({
  chat,
  placeName,
  compact = false,
}: {
  chat: Chat;
  placeName?: string;
  /** An icon button (the chat header) rather than the "Add" text button. */
  compact?: boolean;
}) {
  const { manage, callOver } = useChatActions();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chats.id": chatsParsers["chats.id"],
  });
  const candidates = useCandidates(chat);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const inPerson = chat.type === "huddle";
  // Only picks still on offer: someone who walked off or started talking with
  // others since being picked is left out rather than sent.
  const chosen = candidates.filter((c) => picked.has(c.id) && !c.busy);
  const names = chosen.map((c) => c.name);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function add() {
    setAdding(true);
    try {
      const ids = chosen.map((c) => c.id);
      if (inPerson) {
        const response = await callOver(
          chat,
          ids,
          `waves ${andList(names)} over`,
        );
        // Someone already talking with others (unseen here) means you walk
        // over to their conversation instead: say so and follow it.
        if (response.chatId !== chat.id) {
          toast.info(`You joined ${andList(names)}'s conversation`);
          void setParams({ view: "chats", "chats.id": response.chatId });
        } else toast.success(`Called ${andList(names)} over`);
      } else {
        await manage({
          sessionKey: chat.sessionKey,
          action: "add_members",
          members: ids,
        });
        toast.success(`Added ${andList(names)}`);
      }
      setPicked(new Set());
      setOpen(false);
    } catch (error) {
      failed(inPerson ? "Couldn't call them over" : "Couldn't add them", error);
    } finally {
      setAdding(false);
    }
  }

  const verb = inPerson ? "Call over" : "Add";
  const triggerLabel = inPerson ? "Call people over" : "Add people";
  const hint = inPerson
    ? "They hear you call them over."
    : "They see messages from now on.";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked(new Set());
      }}
    >
      {compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!inPerson && candidates.length === 0}
                  />
                }
              />
            }
          >
            <UserPlusIcon />
            <span className="sr-only">{triggerLabel}</span>
          </TooltipTrigger>
          <TooltipContent>{triggerLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              disabled={!inPerson && candidates.length === 0}
            />
          }
        >
          <UserPlusIcon data-icon="inline-start" />
          Add
        </PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        {inPerson && candidates.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {`Nobody else is ${placeName ? `at ${placeName}` : "here"} to call over.`}
          </p>
        ) : (
          <>
            <Command>
              <CommandInput
                placeholder={
                  inPerson
                    ? `Search ${candidates.length} here`
                    : `Search ${candidates.length} characters`
                }
              />
              <CommandList className="max-h-72">
                <CommandEmpty>Nobody by that name.</CommandEmpty>
                {candidates.map((candidate) => (
                  <CommandItem
                    key={candidate.id}
                    value={`${candidate.name} ${candidate.id}`}
                    data-checked={picked.has(candidate.id)}
                    aria-checked={picked.has(candidate.id)}
                    disabled={Boolean(candidate.busy)}
                    onSelect={() => toggle(candidate.id)}
                  >
                    <PresenceAvatar
                      id={candidate.id}
                      name={candidate.name}
                      avatarUrl={candidate.avatarUrl}
                      kind="agent"
                      size="xs"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          "truncate",
                          candidate.offstage && "text-muted-foreground",
                        )}
                      >
                        {candidate.name}
                      </span>
                      {candidate.busy ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {candidate.busy}
                        </span>
                      ) : null}
                    </span>
                    {candidate.offstage ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Offstage
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            <div className="flex items-center gap-2 border-t p-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {chosen.length === 0 ? hint : andList(names)}
              </p>
              <Button
                size="sm"
                onClick={() => void add()}
                disabled={chosen.length === 0 || adding}
              >
                {adding ? <Spinner data-icon="inline-start" /> : null}
                {chosen.length > 1 ? `${verb} ${chosen.length}` : verb}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The minus on a member's row; it asks in place rather than in a dialog. */
export function RemoveButton({
  name,
  onClick,
}: {
  name: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
          />
        }
      >
        <UserMinusIcon className="size-3.5" />
        <span className="sr-only">{`Remove ${name}`}</span>
      </TooltipTrigger>
      <TooltipContent>Remove from group</TooltipContent>
    </Tooltip>
  );
}

/** Stands in for a member's row until the removal is confirmed or dropped. */
export function RemoveConfirm({
  chat,
  id,
  name,
  onDone,
}: {
  chat: Chat;
  id: string;
  name: string;
  onDone: () => void;
}) {
  const { manage } = useChatActions();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await manage({
        sessionKey: chat.sessionKey,
        action: "remove_members",
        members: [id],
      });
      toast.success(`Removed ${name}`);
      onDone();
    } catch (error) {
      failed(`Couldn't remove ${name}`, error);
      setRemoving(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={`Remove ${name}?`}
      className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2"
    >
      <p className="text-sm leading-snug">
        <span className="font-medium">{`Remove ${name}?`}</span>{" "}
        <span className="text-muted-foreground">
          Everyone in the chat sees it, and they stop getting its messages.
        </span>
      </p>
      <div className="flex justify-end gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={onDone}
          disabled={removing}
          autoFocus
        >
          Cancel
        </Button>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => void remove()}
          disabled={removing}
        >
          {removing ? <Spinner data-icon="inline-start" /> : null}
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Leave a group, or a conversation in person (you stay where you are). */
export function LeaveChat({
  chat,
  title,
  placeName,
}: {
  chat: Chat;
  title: string;
  placeName?: string;
}) {
  const { manage } = useChatActions();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const inPerson = chat.type === "huddle";
  const label = inPerson ? "Leave conversation" : "Leave group";

  async function leave() {
    setLeaving(true);
    try {
      await manage({ sessionKey: chat.sessionKey, action: "leave" });
      toast.success(
        inPerson ? "You left the conversation" : `You left ${title}`,
      );
      setOpen(false);
    } catch (error) {
      failed(
        `Couldn't leave the ${inPerson ? "conversation" : "group"}`,
        error,
      );
    } finally {
      setLeaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>
        <LogOutIcon data-icon="inline-start" />
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {inPerson ? "Leave the conversation?" : `Leave ${title}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {inPerson
              ? `You stay ${placeName ? `at ${placeName}` : "where you are"} and the others carry on without you. Say something to them to join again.`
              : "Everyone in it sees that you left. You can still read it under Other chats, but you can't send to it unless someone adds you back."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void leave()}
            disabled={leaving}
          >
            {leaving ? <Spinner data-icon="inline-start" /> : null}
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
