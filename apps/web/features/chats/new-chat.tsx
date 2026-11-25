"use client";

import { useMemo, useState } from "react";
import { useCastPicks } from "@/hooks/use-cast-picks";
import { useChatActions } from "@/hooks/use-chats";
import { useOccupancy, usePlayer } from "@/hooks/use-location";
import { listNames } from "@/lib/source/chats/display";
import type { Chat } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogPanel } from "@/ui/dialog";
import { TextInput } from "@/ui/input";
import { PickList, type PickGroup } from "@/ui/pick-list";
import { CharacterAvatar } from "../characters/character-avatar";

/**
 * Who to text: one person opens your chat with them (the one there is, or a new
 * one); more start a group, which a name can be given once there are several.
 * Those standing with you come first, since you could just as well talk to them
 * face to face.
 */
export function NewChat({
  open,
  onOpenChange,
  onDirect,
  onGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirect: (id: string) => void;
  onGroup: (chat: Chat) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <NewChatForm
          onDirect={(id) => {
            onOpenChange(false);
            onDirect(id);
          }}
          onGroup={(chat) => {
            onOpenChange(false);
            onGroup(chat);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function NewChatForm({
  onDirect,
  onGroup,
}: {
  onDirect: (id: string) => void;
  onGroup: (chat: Chat) => void;
}) {
  const { player } = useSources();
  const { createChat } = useChatActions();
  const position = usePlayer();
  const cast = useCastPicks([player.id]);
  const occupied = useOccupancy(useMemo(() => cast.map((c) => c.id), [cast]));
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");

  const groups = useMemo((): PickGroup[] => {
    const near = new Set(
      position.placeId ? (occupied.at.get(position.placeId) ?? []) : [],
    );
    const item = (one: (typeof cast)[number]) => ({
      value: one.id,
      label: one.name,
      keywords: one.aliases,
      muted: one.offstage,
      media: (
        <CharacterAvatar
          id={one.id}
          name={one.name}
          avatarUrl={one.avatarUrl}
          kind="agent"
          size="sm"
          decorative
        />
      ),
      ...(near.has(one.id)
        ? { sub: "Here with you" }
        : one.offstage
          ? { sub: "Offstage: won't reply right away" }
          : {}),
    });
    return [
      { label: "Here with you", items: cast.filter((c) => near.has(c.id)) },
      {
        label: "Everyone",
        items: cast.filter((c) => !near.has(c.id) && !c.offstage),
      },
      { label: "Offstage", items: cast.filter((c) => c.offstage) },
    ]
      .map((group) => ({ label: group.label, items: group.items.map(item) }))
      .filter((group) => group.items.length > 0);
  }, [cast, occupied, position.placeId]);

  const chosen = cast.filter((one) => picked.includes(one.id));
  const [only] = chosen;
  const group = chosen.length > 1;

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!only) return;
    if (!group) {
      onDirect(only.id);
      return;
    }
    const title = name.trim();
    onGroup(
      createChat({
        type: "group",
        // Untitled, it is named by its members, as any untitled group is.
        name: title || listNames(chosen.map((one) => one.name)),
        ...(title ? { title } : {}),
        members: chosen.map((one) => one.id),
      }),
    );
  }

  return (
    <DialogPanel
      title="New chat"
      description="Text anyone in the world, wherever they are."
      className="sm:h-[min(36rem,90dvh)]"
      full
    >
      <form
        onSubmit={start}
        className="flex min-h-0 flex-1 flex-col gap-3"
        noValidate
      >
        <PickList
          label="People"
          groups={groups}
          value={picked}
          onValueChange={setPicked}
          placeholder={`Find among ${cast.length}`}
          autoFocus
          className="min-h-0 flex-1"
        />
        {group ? (
          <TextInput
            aria-label="Group name"
            placeholder="Name the group (optional)"
            value={name}
            maxLength={160}
            className="motion-safe:animate-ui-enter"
            onChange={(event) => setName(event.target.value)}
          />
        ) : null}
        <div className="flex shrink-0 justify-end gap-2 max-sm:flex-col-reverse max-sm:*:w-full">
          <DialogClose render={<Button tone="ghost" />}>Cancel</DialogClose>
          <Button type="submit" tone="primary" disabled={!only}>
            {!only
              ? "Pick someone"
              : group
                ? `Start a group of ${chosen.length + 1}`
                : `Message ${only.name}`}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
