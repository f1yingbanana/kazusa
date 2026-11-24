"use client";

import { useMemo, useState } from "react";
import { EyeIcon } from "lucide-react";
import { toast } from "sonner";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { Button } from "@/components/ui/button";
import { CommandItem } from "@/components/ui/command";
import {
  CastPickList,
  type CastPick,
} from "@/components/views/chats/cast-pick-list";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { usePlainText } from "@/components/views/wiki/page-link";
import { useCast, useCharacters } from "@/hooks/use-characters";
import { usePlay } from "@/hooks/use-play";
import { closePlayDialog, useUiStore } from "@/lib/state/ui-store";
import { cn } from "@/lib/utils";

/** The Observer row's value; no character id starts with a colon. */
const OBSERVER = ":observer";

/** Who the person plays: any character of the cast, or nobody (observer). */
export function PlayAsDialog() {
  const { open, pick } = useUiStore((state) => state.playDialog);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePlayDialog()}>
      <DialogContent className="sm:max-w-2xl">
        {open ? <PlayAsForm {...(pick ? { pick } : {})} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ObserverIcon({ className }: { className: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground",
        className,
      )}
    >
      <EyeIcon className="size-4" />
    </span>
  );
}

function PlayAsForm({ pick }: { pick?: string }) {
  const { byId } = useCharacters();
  const { player, watching, play } = usePlay();
  const [picked, setPicked] = useState<string>(
    pick ?? (watching ? OBSERVER : player.id),
  );
  const [switching, setSwitching] = useState(false);
  // Links read as words: following one would leave the choice half made.
  const plain = usePlainText();

  const cast = useCast();
  const current = watching ? undefined : byId.get(player.id);
  // Whether they are onstage doesn't matter here: playing brings them on.
  const picks = useMemo(
    () =>
      cast.map((one): CastPick => ({
        id: one.id,
        name: one.name,
        aliases: one.aliases,
        avatarUrl: one.avatarUrl,
        ...(one.status?.playedBy && one.id !== current?.id
          ? { busy: "Played by someone else" }
          : {}),
      })),
    [cast, current?.id],
  );
  const next = picked === OBSERVER ? undefined : byId.get(picked);
  const unchanged = (next?.id ?? OBSERVER) === (current?.id ?? OBSERVER);

  async function confirm() {
    if (!play || unchanged) return;
    setSwitching(true);
    try {
      await play(next?.id ?? null);
      closePlayDialog();
    } catch (error) {
      toast.error("Couldn't switch", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Play as character</DialogTitle>
      </DialogHeader>

      <div className="grid gap-4 sm:h-80 sm:grid-cols-[15rem_1fr]">
        <CastPickList
          cast={picks}
          picked={new Set([picked])}
          onToggle={setPicked}
          placeholder="Search"
          autoFocus
          defaultValue={picked}
          avatarSize="sm"
          className="h-60 rounded-lg! border sm:h-full"
          listClassName="max-h-none flex-1"
          leading={
            <CommandItem
              value={OBSERVER}
              keywords={["observer"]}
              data-checked={picked === OBSERVER}
              onSelect={() => setPicked(OBSERVER)}
            >
              <ObserverIcon className="size-7" />
              Observer
            </CommandItem>
          }
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {next ? (
              <PresenceAvatar
                id={next.id}
                name={next.name}
                avatarUrl={next.avatarUrl}
                kind={next.kind}
                size="md"
              />
            ) : (
              <ObserverIcon className="size-9" />
            )}
            <p className="truncate text-base font-medium">
              {next ? next.name : "Observer"}
            </p>
          </div>
          <p className="text-pretty">
            {next
              ? plain(next.summary ?? "")
              : "Watch the world without playing anyone."}
          </p>
          {unchanged ? null : (
            <p className="text-pretty text-muted-foreground">
              {[
                next ? "You will take over and play as this character." : "",
                current
                  ? "Your previous character regains autonomous control."
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={closePlayDialog}>
          Cancel
        </Button>
        <Button
          disabled={!play || unchanged || switching}
          onClick={() => void confirm()}
        >
          {switching ? <Spinner data-icon="inline-start" /> : null}
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}
