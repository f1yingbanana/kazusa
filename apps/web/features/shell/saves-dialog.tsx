"use client";

import {
  isRunning,
  type GameSave,
  type RunningVersions,
  type SavePhase,
  type SaveRequest,
} from "@kazusa/client";
import {
  CheckIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";
import { mismatchOf, releaseOf, useSaves } from "@/hooks/use-saves";
import {
  closeSavesDialog,
  openSavesDialog,
  useUiStore,
} from "@/lib/state/ui-store";
import { formatSimDate, formatSimTime } from "@/lib/time/sim";
import { Button, IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Dialog, DialogPanel } from "@/ui/dialog";
import { TextInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { Callout } from "@/ui/settings";
import { toast } from "@/ui/toast";

/** When a save was made: the viewer's own clock, not the world's. */
const REAL_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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

function Steps({ request }: { request: SaveRequest }) {
  const steps = stepsOf(request);
  const current = steps.findIndex((step) =>
    step.phases.includes(request.phase),
  );
  return (
    <ol className="flex flex-col gap-2.5 text-sm" aria-live="polite">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={cx(
            "flex items-center gap-2.5 font-bold",
            index > current && "font-medium text-ui-soft",
          )}
        >
          <span className="grid size-4 place-items-center text-ui-primary [&_svg]:size-4">
            {index < current ? (
              <CheckIcon aria-hidden />
            ) : index === current ? (
              <LoaderCircleIcon
                aria-hidden
                className="motion-safe:animate-ui-spin"
              />
            ) : null}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * A button that asks once more in place: pressed, it says Confirm; pressed
 * again, it acts; focus leaving it, or a few seconds, lets it go.
 */
function ConfirmButton({
  armed,
  icon,
  label,
  danger = false,
  disabled,
  onArm,
  onDisarm,
  onConfirm,
}: {
  armed: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (armed) ref.current?.focus();
  }, [armed]);
  const press = () => {
    if (!armed) return onArm();
    onDisarm();
    onConfirm();
  };
  if (danger && !armed)
    return (
      <IconButton
        label={label}
        tone="danger"
        size="sm"
        disabled={disabled}
        onClick={press}
      >
        {icon}
      </IconButton>
    );
  return (
    <Button
      ref={ref}
      size="sm"
      tone={armed ? (danger ? "danger" : "primary") : "soft"}
      className={cx(!danger && "w-24")}
      disabled={disabled}
      onBlur={onDisarm}
      onClick={press}
      aria-label={armed ? `Confirm ${label.toLowerCase()}` : undefined}
    >
      {armed ? "Confirm" : label}
    </Button>
  );
}

/**
 * A save: an autosave by which one it is, one the player made by their name,
 * else by the world's time then. Delete and Load each turn into Confirm when
 * pressed; an autosave is a slot that's written over, so it isn't deleted.
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
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const autosave = save.kind === "autosave";
  const simTime = save.simTime === null ? null : worldTime(save.simTime);
  const title = autosave ? "Autosave" : (save.name ?? simTime ?? "Save");
  const mismatch = mismatchOf(save, current);
  const facts = [
    save.version ? `World ${save.version}` : null,
    save.branch ? `Branch ${save.branch}` : null,
    save.kazusaVersion ? `Kazusa ${releaseOf(save.kazusaVersion)}` : null,
  ].filter(Boolean);
  const caution = [
    mismatch.kazusa
      ? `Made with Kazusa ${releaseOf(save.kazusaVersion ?? "")}, so it may not load correctly.`
      : null,
    mismatch.world ? `Takes the world back to version ${save.version}.` : null,
  ].filter((line): line is string => Boolean(line));
  return (
    <li className="flex items-start gap-3 rounded-[1rem] bg-ui-ground px-3.5 py-3 inset-ring inset-ring-ui-line">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-bold">{title}</span>
          {autosave && save.name ? (
            <span className="truncate text-xs text-ui-soft">{save.name}</span>
          ) : null}
        </p>
        <div className="flex flex-col text-xs leading-relaxed text-ui-soft">
          {simTime && title !== simTime ? (
            <span>{`World time ${simTime}`}</span>
          ) : null}
          <span>{`Saved ${REAL_TIME.format(Date.parse(save.savedAt))}`}</span>
          {facts.length ? <span>{facts.join(" · ")}</span> : null}
          {caution.map((line) => (
            <span key={line} className="font-bold text-ui-accent-ink">
              {line}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {autosave ? null : deleting ? (
          <LoaderCircleIcon
            aria-label="Deleting"
            className="m-2 size-4 text-ui-soft motion-safe:animate-ui-spin"
          />
        ) : (
          <ConfirmButton
            armed={confirming === "delete"}
            icon={<Trash2Icon aria-hidden />}
            label="Delete"
            danger
            disabled={disabled}
            onArm={() => setConfirming("delete")}
            onDisarm={() => setConfirming(null)}
            onConfirm={onDelete}
          />
        )}
        <ConfirmButton
          armed={confirming === "load"}
          icon={<RotateCcwIcon aria-hidden />}
          label="Load"
          disabled={disabled || !canLoad || deleting}
          onArm={() => setConfirming("load")}
          onDisarm={() => setConfirming(null)}
          onConfirm={onLoad}
        />
      </div>
    </li>
  );
}

/** Beside the clock: opens Saves, and spins while one runs. */
export function SavesButton() {
  const { enabled, request, refresh } = useSaves();
  if (!enabled) return null;
  const running = isRunning(request);
  return (
    <IconButton
      label={running ? "Saving or loading…" : "Save or load"}
      tone="ghost"
      pending={running}
      onClick={() => {
        openSavesDialog();
        void refresh();
      }}
    >
      <SaveIcon aria-hidden />
    </IconButton>
  );
}

/**
 * Saving the game and loading a save. Both restart the Gateway
 * (`scripts/dev.mjs`), so while one runs the dialog stays open and can't be
 * dismissed, and a page opened meanwhile opens it too. After a load the page
 * reloads into the loaded world.
 */
export function SavesDialog() {
  const {
    enabled,
    saves,
    request,
    current,
    supervised,
    loading,
    error,
    save,
    load,
    remove,
  } = useSaves();
  const open = useUiStore((state) => state.savesDialog.open);
  const { mutate } = useSWRConfig();
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
    <Dialog
      open={open || running}
      dismissible={!busy}
      onOpenChange={(next) => {
        if (next || busy) return;
        setFailure(null);
        closeSavesDialog();
      }}
    >
      <DialogPanel
        title={
          running ? (request?.op === "load" ? "Loading" : "Saving") : "Saves"
        }
        description={
          running
            ? "Everyone pauses while this runs. It takes a moment."
            : "A save keeps the whole world as it is now: chats, characters and what they remember."
        }
        className="sm:max-h-[min(36rem,85dvh)]"
      >
        {running && request ? (
          <Steps request={request} />
        ) : (
          <>
            {failure ? (
              <Callout tone="danger" title="That didn't work">
                {failure}
              </Callout>
            ) : null}
            {!loading && !supervised ? (
              <Callout>
                Saving and loading need Kazusa's app or{" "}
                <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
                  npm run dev
                </code>
                .
              </Callout>
            ) : null}
            <form className="flex gap-2" onSubmit={onSubmit}>
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Name (optional)"
                aria-label="Save name"
                maxLength={200}
                disabled={busy || !supervised}
                className="flex-1"
              />
              <Button
                type="submit"
                tone="primary"
                pending={posting === "save"}
                disabled={busy || !supervised}
              >
                Save now
              </Button>
            </form>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {error ? (
                <Note>{error.message}</Note>
              ) : loading ? (
                <LoaderCircleIcon
                  aria-label="Loading saves"
                  className="mx-auto size-5 text-ui-soft motion-safe:animate-ui-spin"
                />
              ) : saves.length === 0 ? (
                <Note>No saves yet.</Note>
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
      </DialogPanel>
    </Dialog>
  );
}
