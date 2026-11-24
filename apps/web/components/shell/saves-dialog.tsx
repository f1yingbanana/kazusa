"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckIcon,
  ClockIcon,
  GitBranchIcon,
  GlobeIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isRunning,
  mismatchOf,
  releaseOf,
  useSaves,
  type GameSave,
  type RunningVersions,
  type SavePhase,
  type SaveRequest,
} from "@/hooks/use-saves";
import { formatSimDate, formatSimTime } from "@/lib/time/sim";
import { cn } from "@/lib/utils";

/** When a save was made: the viewer's own clock, not the world's. */
const REAL_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The simulation's date and time, short as the top bar's: fits a phone. */
const worldTime = (time: number) =>
  `${formatSimDate(time)}, ${formatSimTime(time)}`;

/** Autosaves first, always; then the player's, newest first. */
const pinned = (saves: readonly GameSave[]): GameSave[] =>
  [...saves].sort(
    (a, b) => Number(b.kind === "autosave") - Number(a.kind === "autosave"),
  );

const WARNED_KEY = "kazusa.saves.warned";

/** Whether this load's warnings were shown; marks them shown. */
function warned(id: string): boolean {
  try {
    if (window.localStorage.getItem(WARNED_KEY) === id) return true;
    window.localStorage.setItem(WARNED_KEY, id);
  } catch {
    // Shown again next time; harmless.
  }
  return false;
}

/** What the owner waits through, in order, and which phases each covers. */
function stepsOf(
  request: SaveRequest,
): { label: string; phases: SavePhase[] }[] {
  return request.op === "save"
    ? [
        { label: "Pausing", phases: ["waiting", "pausing"] },
        { label: "Waiting for everyone to finish", phases: ["stopping"] },
        { label: "Saving", phases: ["saving"] },
        { label: "Resuming", phases: ["starting"] },
      ]
    : [
        {
          label: "Waiting for everyone to finish",
          phases: ["waiting", "pausing", "stopping"],
        },
        { label: "Loading", phases: ["loading"] },
        { label: "Resuming, paused", phases: ["starting"] },
      ];
}

function Progress({ request }: { request: SaveRequest }) {
  const steps = stepsOf(request);
  const current = steps.findIndex((step) =>
    step.phases.includes(request.phase),
  );
  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={cn(
            "flex items-center gap-2",
            index > current && "text-muted-foreground",
          )}
        >
          <span className="flex size-4 items-center justify-center">
            {index < current ? (
              <CheckIcon className="size-4" />
            ) : index === current ? (
              <Spinner className="size-4" />
            ) : null}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/** Something about a save, with what it is in a tooltip: "Simulation time". */
function Labelled({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("inline-flex w-fit items-center gap-1.5", className)}
          />
        }
      >
        {children}
        <span className="sr-only">{` (${label})`}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const SIM_TIME = "Simulation time";
const SAVED_ON = "Saved on";

/**
 * A button that asks once more in place: pressed, it becomes "Confirm" with its
 * icon; pressed again, it acts; focus leaving it, or a few seconds, lets it go.
 * Delete is an icon until then and grows to the left, Load keeps one width, so
 * nothing else in the row moves.
 */
function ConfirmButton({
  armed,
  icon: Icon,
  label,
  destructive = false,
  disabled,
  onArm,
  onDisarm,
  onConfirm,
}: {
  armed: boolean;
  icon: typeof Trash2Icon;
  label: string;
  destructive?: boolean;
  disabled: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onConfirm: () => void;
}) {
  const iconOnly = destructive && !armed;
  // Armed, it's a new element: focus it, so leaving it lets it go.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (armed) ref.current?.focus();
  }, [armed]);
  const props = {
    ref,
    size: iconOnly ? ("icon-sm" as const) : ("sm" as const),
    variant: armed
      ? destructive
        ? ("destructive" as const)
        : ("default" as const)
      : destructive
        ? ("ghost" as const)
        : ("outline" as const),
    className: cn(!destructive && "w-24"),
    disabled,
    onBlur: onDisarm,
    onClick: () => {
      if (!armed) return onArm();
      onDisarm();
      onConfirm();
    },
  };
  if (iconOnly)
    // An icon alone says what it does in a tooltip.
    return (
      <Tooltip>
        <TooltipTrigger render={<Button {...props} />}>
          <Icon />
          <span className="sr-only">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  return (
    <Button {...props}>
      {armed ? (
        <>
          <Icon />
          Confirm
          <span className="sr-only">{` ${label.toLowerCase()}`}</span>
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/**
 * A save. An autosave is titled Autosave, with which one it is (the last stop,
 * the world's start, before an update); a save the player made, by their name,
 * else by the simulation time then. Each time says which it is in a tooltip and
 * its own icon. Delete and Load each turn into Confirm when pressed, in place;
 * an autosave is a slot that's written over, so it isn't deleted.
 */
function SaveRow({
  save,
  current,
  disabled,
  deleting,
  canLoad,
  onLoad,
  onDelete,
}: {
  save: GameSave;
  current: RunningVersions | null;
  disabled: boolean;
  deleting: boolean;
  /** Loading needs `scripts/dev.mjs`, which restarts the Gateway. */
  canLoad: boolean;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState<"load" | "delete" | null>(null);
  // Let go after a moment too, wherever focus went.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const autosave = save.kind === "autosave";
  const simTime = save.simTime === null ? null : worldTime(save.simTime);
  // Unnamed, the simulation time is the title; otherwise it's a detail.
  const timeTitle = !autosave && !save.name && simTime !== null;
  const mismatch = mismatchOf(save, current);
  const caution = [
    mismatch.kazusa
      ? `Made with Kazusa ${releaseOf(save.kazusaVersion ?? "")}, so it may not load correctly.`
      : null,
    mismatch.world ? `Takes the world back to version ${save.version}.` : null,
  ].filter((line): line is string => Boolean(line));
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-2.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-1.5">
            {timeTitle ? (
              <Labelled label={SIM_TIME} className="font-medium">
                <GlobeIcon className="size-3.5 shrink-0" aria-hidden />
                {simTime}
              </Labelled>
            ) : (
              <span className="truncate font-medium">
                {autosave ? "Autosave" : save.name}
              </span>
            )}
            {autosave && save.name && (
              <span className="truncate text-xs text-muted-foreground">
                {save.name}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {!timeTitle && simTime && (
              <Labelled label={SIM_TIME}>
                <GlobeIcon className="size-3 shrink-0" aria-hidden />
                {simTime}
              </Labelled>
            )}
            <Labelled label={SAVED_ON}>
              <ClockIcon className="size-3 shrink-0" aria-hidden />
              {REAL_TIME.format(Date.parse(save.savedAt))}
            </Labelled>
            <div className="flex flex-wrap items-center gap-x-1.5">
              {save.version && (
                <Labelled label="World version">{`World ${save.version}`}</Labelled>
              )}
              {save.branch && (
                <Labelled label="Branch">
                  <GitBranchIcon className="size-3 shrink-0" aria-hidden />
                  {save.branch}
                </Labelled>
              )}
              {save.kazusaVersion && (
                <Labelled
                  label="Kazusa version"
                  className={cn(
                    mismatch.kazusa && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {`Kazusa ${releaseOf(save.kazusaVersion)}`}
                </Labelled>
              )}
            </div>
            {caution.map((line) => (
              <p key={line} className="text-amber-600 dark:text-amber-400">
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {deleting ? (
            <Spinner className="m-1.5" />
          ) : (
            !autosave && (
              <ConfirmButton
                armed={confirming === "delete"}
                icon={Trash2Icon}
                label="Delete"
                destructive
                disabled={disabled}
                onArm={() => setConfirming("delete")}
                onDisarm={() => setConfirming(null)}
                onConfirm={onDelete}
              />
            )
          )}
          <ConfirmButton
            armed={confirming === "load"}
            icon={RotateCcwIcon}
            label="Load"
            disabled={disabled || !canLoad || deleting}
            onArm={() => setConfirming("load")}
            onDisarm={() => setConfirming(null)}
            onConfirm={onLoad}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Saving the game and loading a save, beside the clock. Both restart the
 * Gateway (`scripts/dev.mjs`), so while one runs the dialog stays open and
 * can't be dismissed, and a page opened meanwhile opens it too. After a load
 * the page reloads into the loaded world.
 */
export function SavesButton() {
  const {
    enabled,
    saves,
    request,
    current,
    supervised,
    loading,
    error,
    refresh,
    save,
    load,
    remove,
  } = useSaves();
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  /** What this page has asked for and awaits: `save`, or a save it deletes. */
  const [posting, setPosting] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The request this page saw running, to act once it ends. */
  const watched = useRef<string | null>(null);
  const running = isRunning(request);
  const busy = running || posting !== null;

  useEffect(() => {
    if (!request) return;
    if (running) {
      watched.current = request.id;
      return;
    }
    // A load that kept less of this machine than it should have says so once,
    // after the reload into the loaded world.
    if (
      request.op === "load" &&
      request.phase === "done" &&
      request.warnings?.length &&
      watched.current !== request.id &&
      !warned(request.id)
    )
      toast.warning("Loaded, with a problem", {
        description: request.warnings.join(" "),
        duration: 30_000,
      });
    if (watched.current !== request.id) return;
    watched.current = null;
    if (request.phase === "failed") {
      setFailure(request.error ?? "Something went wrong.");
    } else if (request.op === "load") {
      window.location.reload();
    } else {
      toast.success(request.name ? `Saved “${request.name}”` : "Saved");
      setName("");
    }
    // Whatever was asked while the world was down failed: ask again.
    void mutate(() => true);
  }, [request, running, mutate]);

  if (!enabled) return null;

  async function run(what: string, action: () => Promise<unknown>) {
    setFailure(null);
    setPosting(what);
    try {
      await action();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPosting(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run("save", () => save(name.trim()));
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={running ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => {
                setFailure(null);
                setOpen(true);
                void refresh();
              }}
            />
          }
        >
          {running ? <Spinner /> : <SaveIcon />}
          <span className="sr-only">Saves</span>
        </TooltipTrigger>
        <TooltipContent>Save or load</TooltipContent>
      </Tooltip>
      <Dialog
        open={open || running}
        onOpenChange={(next) => {
          // Saving and loading can't be left midway.
          if (!busy) setOpen(next);
        }}
        disablePointerDismissal={busy}
      >
        <ResponsiveDialogContent
          className="flex flex-col gap-4 sm:max-h-[min(32rem,85dvh)] sm:max-w-md"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>
              {running
                ? request?.op === "load"
                  ? "Loading"
                  : "Saving"
                : "Saves"}
            </DialogTitle>
            {!running && (
              <DialogDescription>
                Snapshot your current world state, saving chats, characters and
                memory.
              </DialogDescription>
            )}
          </DialogHeader>

          {running && request ? (
            <Progress request={request} />
          ) : (
            <>
              {failure && (
                <Alert variant="destructive">
                  <AlertDescription>{failure}</AlertDescription>
                </Alert>
              )}
              {!loading && !supervised && (
                <Alert>
                  <AlertDescription>
                    Saving and loading need Kazusa&apos;s app or{" "}
                    <code>npm run dev</code>.
                  </AlertDescription>
                </Alert>
              )}
              <form className="flex gap-2" onSubmit={onSubmit}>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name (optional)"
                  aria-label="Save name"
                  maxLength={200}
                  disabled={busy || !supervised}
                />
                <Button type="submit" disabled={busy || !supervised}>
                  {posting === "save" ? <Spinner /> : null}
                  Save
                </Button>
              </form>
              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {error ? (
                  <p className="text-sm text-muted-foreground">
                    {error.message}
                  </p>
                ) : loading ? (
                  <Spinner />
                ) : saves.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No saves yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {pinned(saves).map((entry) => (
                      <SaveRow
                        key={entry.ref}
                        save={entry}
                        current={current}
                        disabled={busy}
                        deleting={posting === entry.ref}
                        canLoad={supervised}
                        onLoad={() => void run("load", () => load(entry.ref))}
                        onDelete={() =>
                          void run(entry.ref, () => remove(entry.ref))
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      </Dialog>
    </>
  );
}
