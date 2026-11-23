"use client";

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CastPickList, useCastPicks } from "./cast-pick-list";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatActions } from "@/hooks/use-chats";
import { listNames } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import type { Chat } from "@/lib/source/chats/types";

/**
 * A chat with whoever is picked: one is your direct chat with them (the one
 * there already is, or a new one), more a new group, a draft until its first
 * message is sent.
 */
export function NewChatDialog({
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
      <DialogContent className="sm:max-w-md">
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
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewChatForm({
  onDirect,
  onGroup,
  onCancel,
}: {
  onDirect: (id: string) => void;
  onGroup: (chat: Chat) => void;
  onCancel: () => void;
}) {
  const { player } = useSources();
  const { createChat } = useChatActions();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Anyone in the world but you.
  const cast = useCastPicks([player.id]);
  const chosen = cast.filter((one) => picked.has(one.id));
  const away = chosen.some((one) => one.offstage);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [only] = chosen;
    if (!only) return;
    if (chosen.length === 1) {
      onDirect(only.id);
      return;
    }
    onGroup(
      createChat({
        type: "group",
        // Untitled: named by its members, as any untitled group is.
        name: listNames(chosen.map((one) => one.name)),
        members: chosen.map((one) => one.id),
      }),
    );
  }

  return (
    <form onSubmit={start} className="flex min-w-0 flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New chat</DialogTitle>
      </DialogHeader>

      <div className="flex min-w-0 flex-col gap-2">
        <CastPickList
          cast={cast}
          picked={picked}
          onToggle={toggle}
          placeholder={`Search ${cast.length} characters`}
          autoFocus
          className="h-64 rounded-lg! border"
          listClassName="max-h-none flex-1"
        />
        <p className="text-xs text-muted-foreground">{`${chosen.length} picked`}</p>
        {away ? (
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <TriangleAlertIcon
              aria-hidden
              className="mt-px size-3.5 shrink-0"
            />
            <span className="min-w-0">
              Offstage characters won&apos;t reply right away.
            </span>
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={chosen.length === 0}>
          Start
        </Button>
      </DialogFooter>
    </form>
  );
}
