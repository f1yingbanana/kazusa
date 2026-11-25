"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  DoorOpenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { useAccess } from "@/hooks/use-access";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { createOpenGroup } from "@/lib/source/chats/http";
import { CastPickList, useCastPicks } from "./cast-pick-list";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { useChatActions } from "@/hooks/use-chats";
import { listNames } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import type { Chat } from "@/lib/source/chats/types";

/**
 * A chat with whoever is picked: one is your direct chat with them (the one
 * there already is, or a new one), more a new group, a draft until its first
 * message is sent. Or, a step further, an open group: nobody in it yet, and
 * anyone can join it (a Discord channel's group). Someone only watching can
 * make only that, so the dialog opens on it.
 */
export function NewChatDialog({
  open,
  onOpenChange,
  onDirect,
  onGroup,
  onOpenGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirect: (id: string) => void;
  onGroup: (chat: Chat) => void;
  onOpenGroup: (chatId: string) => void;
}) {
  const { watching } = useSources();
  const { canPlay } = useAccess();
  const [step, setStep] = useState<"people" | "open">("people");
  const showOpen = watching || step === "open";

  function change(next: boolean) {
    if (!next) setStep("people");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {!open ? null : showOpen ? (
          <OpenGroupForm
            onBack={watching ? undefined : () => setStep("people")}
            onCreated={(chatId) => {
              change(false);
              onOpenGroup(chatId);
            }}
            onCancel={() => change(false)}
          />
        ) : (
          <NewChatForm
            onOpenGroup={canPlay ? () => setStep("open") : undefined}
            onDirect={(id) => {
              change(false);
              onDirect(id);
            }}
            onGroup={(chat) => {
              change(false);
              onGroup(chat);
            }}
            onCancel={() => change(false)}
          />
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

/** An open group's title; it is made at once, with nobody in it. */
function OpenGroupForm({
  onBack,
  onCreated,
  onCancel,
}: {
  /** Back to picking people; none when that isn't on offer. */
  onBack?: () => void;
  onCreated: (chatId: string) => void;
  onCancel: () => void;
}) {
  const { reload } = useObservedChats();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const named = title.trim();

  // Whether this form is still the one on screen (StrictMode mounts twice).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!named) return;
    setSaving(true);
    try {
      const chatId = await createOpenGroup(named);
      await reload();
      toast.success(`Made ${named}`);
      // Closed meanwhile (another dialog may be open now): made, not opened.
      if (alive.current) onCreated(chatId);
    } catch (error) {
      toast.error("Couldn't make the group", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={create} className="flex min-w-0 flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New open group</DialogTitle>
        <DialogDescription>
          Nobody is in it yet. Characters and people join it themselves, and you
          can link it to a Discord channel from its sidebar.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="open-group-title">Title</FieldLabel>
        <Input
          id="open-group-title"
          placeholder="SCHALE Office Line"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          autoFocus
        />
        <FieldDescription>
          How it appears in everyone&apos;s chats.
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onBack ?? onCancel}
          disabled={saving}
        >
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button type="submit" disabled={!named || saving}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Make group
        </Button>
      </DialogFooter>
    </form>
  );
}

function NewChatForm({
  onOpenGroup,
  onDirect,
  onGroup,
  onCancel,
}: {
  /** Goes on to make an open group; none for someone who can't. */
  onOpenGroup?: () => void;
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

      {onOpenGroup ? (
        <Item
          size="xs"
          render={<button type="button" onClick={onOpenGroup} />}
          className="-mt-1 cursor-pointer text-left hover:bg-muted/60"
        >
          <ItemMedia className="size-7 rounded-full bg-muted text-muted-foreground">
            <DoorOpenIcon aria-hidden className="size-3.5" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>New open group</ItemTitle>
            <ItemDescription>
              Anyone can join it, and it can link to Discord
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          </ItemActions>
        </Item>
      ) : null}

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
