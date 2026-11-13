"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useUpdate, type UpdatePhase } from "@/hooks/use-update";
import { useLiveTemplateDownload } from "@/hooks/use-world-downloads";
import { useWorldCheck, useWorldUpdate } from "@/hooks/use-world-update";
import { DownloadProgress } from "@/components/setup/download-progress";
import type { UpdateChannel, UpdateTarget } from "@/lib/update/update";
import { useSources } from "@/lib/source/provider";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

const LINK =
  "inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground";

/** Real time: releases happen outside the world. */
function ago(date: string) {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

function Dot() {
  return <span aria-hidden>·</span>;
}

function VersionRow({
  label,
  version,
  details,
  note,
  action,
}: {
  label: string;
  version: string | null;
  details?: React.ReactNode;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "truncate",
              version ? "font-mono text-foreground" : undefined,
            )}
          >
            {version ?? "None yet"}
          </span>
          {details}
        </span>
        {note ? (
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : null}
      </div>
      {action}
    </li>
  );
}

function TargetAction({
  target,
  primary,
  disabled,
  onUpdate,
}: {
  target: UpdateTarget;
  primary: boolean;
  disabled: boolean;
  onUpdate: () => void;
}) {
  if (target.status === "current")
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5" />
        Installed
      </span>
    );
  if (target.status === "older")
    return (
      <span className="shrink-0 text-xs text-muted-foreground">
        Yours is newer
      </span>
    );
  if (!target.installable && target.build === "building")
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Building
      </span>
    );
  if (!target.installable && target.build === "failed") return null;
  if (!target.installable)
    return (
      <a href={target.url} target="_blank" rel="noreferrer" className={LINK}>
        Get the installer
        <ArrowUpRightIcon className="size-3" />
      </a>
    );
  return (
    <Button
      size="sm"
      variant={primary ? "default" : "outline"}
      className="shrink-0"
      disabled={disabled}
      onClick={onUpdate}
    >
      Update
    </Button>
  );
}

/** Why a release this copy can't install yet isn't ready. */
function releaseNote(release: UpdateTarget | null | undefined) {
  if (!release || release.installable || release.status !== "newer")
    return undefined;
  if (release.build === "building")
    return "Its downloads are still being built, which takes about half an hour. Kazusa lets you know when it’s ready.";
  if (release.build === "failed")
    return "Its downloads failed to build, so it can’t be installed yet.";
  return undefined;
}

function Progress({ phase }: { phase: UpdatePhase }) {
  return (
    <div role="status" className="flex items-start gap-2 text-sm">
      <Spinner className="mt-0.5 shrink-0" />
      {phase.step === "downloading" ? (
        <span>
          Downloading{phase.version ? ` ${phase.version}` : " the update"}…
        </span>
      ) : (
        <span className="flex flex-col gap-0.5">
          <span>Restarting into {phase.version}…</span>
          <span className="text-xs text-pretty text-muted-foreground">
            Characters finish what they’re doing first, so this can take a few
            minutes. Kazusa’s terminal window shows how it’s going.
          </span>
        </span>
      )}
    </div>
  );
}

/** Kazusa's version, then the world's. */
export function UpdateSettings() {
  return (
    <>
      <KazusaVersion />
      <WorldVersion />
    </>
  );
}

/**
 * The world's version, and a newer one of its template when Kazusa has
 * downloaded it. The system agent brings it in, so updating means asking them.
 */
function WorldVersion() {
  const { world, worldResource } = useSources();
  const { update, admin, canAsk, asking, ask } = useWorldUpdate();
  const download = useLiveTemplateDownload(true, 1000);
  const checker = useWorldCheck();
  const credit = world?.package;

  // An update brought in since the page loaded no longer shows as new.
  useEffect(() => {
    void worldResource.mutate();
  }, []);

  if (!credit) return null;

  async function handleCheck() {
    try {
      await checker.check();
    } catch (failure) {
      toast.error("Couldn't check for a new version", {
        description: failure instanceof Error ? failure.message : undefined,
      });
    }
  }

  const checkNote =
    checker.result?.held === "updating"
      ? `Checking waits until ${admin} finishes updating your world.`
      : checker.result?.lines?.join(" ") || undefined;

  async function handleAsk() {
    try {
      await ask();
    } catch (failure) {
      toast.error(`Couldn't message ${admin}`, {
        description: failure instanceof Error ? failure.message : undefined,
      });
    }
  }

  return (
    <SettingsSection
      title="World"
      description={`New versions of ${credit.name} download when Kazusa starts and every hour after. ${admin} brings them into your world, keeping everything that happened in it.`}
      action={
        checker.enabled ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={checker.checking || Boolean(download)}
            onClick={() => void handleCheck()}
          >
            <RefreshCwIcon
              className={cn(
                checker.checking && "animate-spin motion-reduce:animate-none",
              )}
            />
            Check again
          </Button>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        <VersionRow
          label="Your world"
          version={credit.version ?? "Unknown"}
          note={update || download ? undefined : checkNote}
          action={
            update || download || checkNote ? null : (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <CheckIcon className="size-3.5" />
                Up to date
              </span>
            )
          }
        />
        {update ? (
          <VersionRow
            label="Latest version"
            version={update.version}
            note={
              canAsk
                ? `${admin} will ask a few questions first, such as whether the changes happened in the story or were always so.`
                : `Ask the world's owner to have ${admin} update it.`
            }
            action={
              canAsk ? (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={asking}
                  onClick={() => void handleAsk()}
                >
                  {asking ? <Spinner /> : null}
                  Ask {admin}
                </Button>
              ) : null
            }
          />
        ) : null}
      </ul>
      {download ? (
        <div className="flex flex-col gap-1.5">
          <DownloadProgress
            title={
              download.kind === "update"
                ? `the newest ${credit.name}`
                : credit.name
            }
            download={download}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            {admin} can update your world once it’s done. Your world plays as
            usual meanwhile.
          </p>
        </div>
      ) : null}
    </SettingsSection>
  );
}

/** This copy's version, and updating it to the latest release or to `main`. */
function KazusaVersion() {
  const { status, error, checking, phase, check, update } = useUpdate();
  const busy = phase !== null || !!status?.blocked;

  async function handleUpdate(to: UpdateChannel) {
    try {
      await update(to);
    } catch (failure) {
      toast.error("Couldn't update", {
        description: failure instanceof Error ? failure.message : undefined,
      });
    }
  }

  const development = status?.development;
  const release = status?.release;
  const newChanges =
    development?.status === "newer" && development.changes
      ? `${development.changes} new change${development.changes === 1 ? "" : "s"}`
      : null;

  return (
    <SettingsSection
      title="Version"
      description="Updating restarts Kazusa. Your world stays as it is."
      action={
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={checking || phase !== null}
          onClick={() => void check()}
        >
          <RefreshCwIcon
            className={cn(
              checking && "animate-spin motion-reduce:animate-none",
            )}
          />
          Check again
        </Button>
      }
    >
      {status?.failed ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t update to {status.failed.version}</AlertTitle>
          <AlertDescription>
            {status.failed.error} This copy and your world are as they were.
          </AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          <VersionRow
            label="This copy"
            version={status.current.version ?? "Unknown"}
            details={
              status.current.branch && status.current.branch !== "main" ? (
                <>
                  <Dot />
                  <span className="truncate">on {status.current.branch}</span>
                </>
              ) : null
            }
          />
          {status.error ? null : (
            <>
              <VersionRow
                label="Latest release"
                version={release?.version ?? null}
                details={
                  release ? (
                    <>
                      <Dot />
                      <span>{ago(release.date)}</span>
                      <Dot />
                      <a
                        href={release.url}
                        target="_blank"
                        rel="noreferrer"
                        className={LINK}
                      >
                        Release notes
                        <ArrowUpRightIcon className="size-3" />
                      </a>
                    </>
                  ) : null
                }
                note={releaseNote(release)}
                action={
                  release ? (
                    <TargetAction
                      target={release}
                      primary
                      disabled={busy}
                      onUpdate={() => void handleUpdate("release")}
                    />
                  ) : null
                }
              />
              <VersionRow
                label="Development"
                version={development?.version ?? null}
                details={
                  development ? (
                    <>
                      <Dot />
                      <span>{ago(development.date)}</span>
                      {newChanges ? (
                        <>
                          <Dot />
                          <span>{newChanges}</span>
                        </>
                      ) : null}
                    </>
                  ) : null
                }
                note={
                  development?.installable === false
                    ? "Unreleased. Installing it needs a copy set up with git and Node.js."
                    : "Unreleased. The newest changes, and the least tested."
                }
                action={
                  // An installer's copy only takes releases.
                  development &&
                  (development.installable ||
                    development.status === "current" ||
                    development.status === "older") ? (
                    <TargetAction
                      target={development}
                      primary={false}
                      disabled={busy}
                      onUpdate={() => void handleUpdate("development")}
                    />
                  ) : null
                }
              />
            </>
          )}
        </ul>
      ) : error ? null : (
        <p className="text-sm text-muted-foreground">Checking for updates…</p>
      )}
      {phase ? (
        <Progress phase={phase} />
      ) : status?.error || error ? (
        <p className="text-sm text-destructive">
          {status?.error ?? error?.message}
        </p>
      ) : status?.blocked ? (
        <p className="text-sm text-pretty text-muted-foreground">
          {status.blocked}
        </p>
      ) : null}
    </SettingsSection>
  );
}
