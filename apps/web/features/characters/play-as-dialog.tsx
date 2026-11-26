"use client";

import { EyeIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCast, useCharacters } from "@/hooks/use-characters";
import { usePlay } from "@/hooks/use-play";
import { usePageName } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { closePlayDialog, useUiStore } from "@/lib/state/ui-store";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { ChooseList } from "@/ui/choose-list";
import { Dialog, DialogClose, DialogPanel } from "@/ui/dialog";
import type { PickGroup } from "@/ui/pick-list";
import { usePlainText } from "../wiki/links";
import { CharacterAvatar } from "./character-avatar";

/** The observer's value; no character id starts with a colon. */
const OBSERVER = ":observer";

function WatchMark({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        large
          ? "grid size-17 shrink-0 place-items-center rounded-full border-2 border-dashed border-ui-line text-ui-soft [&_svg]:size-6"
          : "grid size-7 shrink-0 place-items-center rounded-full border-2 border-dashed border-ui-line text-ui-soft [&_svg]:size-3.5"
      }
    >
      <EyeIcon />
    </span>
  );
}

/**
 * Who the person is in the world: one of the cast, or nobody, watching. The
 * list chooses, the side says who that is and what the switch does to whoever
 * is left, and the button names the act.
 */
export function PlayAsDialog() {
  const { open, pick } = useUiStore((state) => state.playDialog);
  const [switching, setSwitching] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !switching) closePlayDialog();
      }}
    >
      {open ? (
        <PlayAsForm
          pick={pick}
          switching={switching}
          setSwitching={setSwitching}
        />
      ) : null}
    </Dialog>
  );
}

function PlayAsForm({
  pick,
  switching,
  setSwitching,
}: {
  pick?: string | undefined;
  switching: boolean;
  setSwitching: (switching: boolean) => void;
}) {
  const { byId } = useCharacters();
  const cast = useCast();
  const { player, watching, play } = usePlay();
  const pageName = usePageName();
  // Links read as words: following one would leave the choice half made.
  const plain = usePlainText();
  const current = watching ? undefined : byId.get(player.id);
  const [chosen, setChosen] = useState(pick ?? current?.id ?? OBSERVER);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  const groups = useMemo<PickGroup[]>(
    () => [
      {
        label: "Watch",
        items: [
          {
            value: OBSERVER,
            label: "Observer",
            sub: "Watch without playing anyone",
            keywords: ["observer", "watch"],
            media: <WatchMark />,
          },
        ],
      },
      {
        label: "Play",
        items: cast.map((one) => {
          const elsewhere =
            Boolean(one.status?.playedBy) && one.id !== current?.id;
          return {
            value: one.id,
            label: one.name,
            keywords: one.aliases,
            sub: elsewhere
              ? "Played by someone else"
              : one.id === current?.id
                ? "You play them now"
                : one.groups?.[0]
                  ? pageName(one.groups[0])
                  : undefined,
            disabled: elsewhere,
            media: (
              <CharacterAvatar
                id={one.id}
                name={one.name}
                avatarUrl={one.avatarUrl}
                kind={one.kind}
                size="sm"
                decorative
              />
            ),
          };
        }),
      },
    ],
    [cast, current?.id, pageName],
  );

  const next = chosen === OBSERVER ? undefined : byId.get(chosen);
  const elsewhere = Boolean(next?.status?.playedBy) && next?.id !== current?.id;
  const unchanged = (next?.id ?? OBSERVER) === (current?.id ?? OBSERVER);
  const summaryText = next
    ? plain(next.summary ?? "").trim()
    : "See everything, everywhere, and talk to nobody but the world's console.";
  const consequence = elsewhere
    ? `${firstName(next!.name)} is already being played by someone else.`
    : unchanged
      ? next
        ? `You play ${firstName(next.name)} now.`
        : "You're watching now."
      : [
          next
            ? `You take over ${firstName(next.name)}: they say and do only what you choose, and come onstage if they were off.`
            : "You stop playing and watch.",
          current
            ? `${firstName(current.name)} goes back to thinking for themselves, after looking back on what you did as them.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");

  async function confirm() {
    if (!play || unchanged || elsewhere) return;
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
    <DialogPanel
      title="Play as character"
      description="Be someone in the world, or watch it."
      size="lg"
      full
      className="sm:h-[min(34rem,90dvh)]"
      footer={
        <>
          <DialogClose render={<Button tone="ghost" disabled={switching} />}>
            Cancel
          </DialogClose>
          <Button
            tone="primary"
            disabled={!play || unchanged || elsewhere}
            pending={switching}
            onClick={() => void confirm()}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 flex-1 gap-4 max-sm:grid-rows-[16rem_minmax(0,1fr)] sm:grid-cols-[16rem_minmax(0,1fr)]">
        <ChooseList
          label="Who to play"
          groups={groups}
          value={chosen}
          onValueChange={setChosen}
          placeholder={`Search ${cast.length} characters`}
          autoFocus
          className="max-sm:h-64"
        />
        <section
          aria-live="polite"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[1.25rem] bg-ui-ground p-4"
        >
          <div className="flex items-center gap-3">
            {next ? (
              next.avatarUrl && failedAvatar !== next.avatarUrl ? (
                <img
                  src={next.avatarUrl}
                  alt=""
                  onError={() => setFailedAvatar(next.avatarUrl ?? null)}
                  className="size-17 shrink-0 rounded-[1rem] object-cover"
                />
              ) : (
                <Avatar name={next.name} size="lg" decorative />
              )
            ) : (
              <WatchMark large />
            )}
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[1.0625rem] font-extrabold">
                {next ? next.name : "Observer"}
              </p>
              {next?.groups?.[0] ? (
                <p className="truncate text-[0.8125rem] text-ui-soft">
                  {pageName(next.groups[0])}
                </p>
              ) : null}
            </div>
          </div>
          {summaryText ? (
            <p className="text-[0.9375rem] leading-relaxed text-pretty">
              {summaryText}
            </p>
          ) : null}
          <p className="mt-auto text-[0.8125rem] leading-normal text-pretty text-ui-soft">
            {consequence}
          </p>
        </section>
      </div>
    </DialogPanel>
  );
}
