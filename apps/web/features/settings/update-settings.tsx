"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/ui/toast";
import { useUpdate, type UpdatePhase } from "@/hooks/use-update";
import {
  offered,
  reasonOf,
  useWorldCheck,
  useWorldUpdate,
  versionLabel,
} from "@/hooks/use-world-update";
import { formatBytes } from "@/lib/format";
import type { WorldDownload } from "@/lib/run-script";
import { useSources } from "@/lib/source/provider";
import { openUpdateSaveDialog } from "@/lib/state/ui-store";
import type { UpdateChannel, UpdateTarget } from "@/lib/update/update";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { ProgressBar } from "@/ui/progress";
import {
  Callout,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/ui/settings";

function ago(date: string) {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

function Dot() {
  return <span aria-hidden>·</span>;
}

function NotesLink({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <>
      <Dot />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ui-soft underline-offset-4 hover:text-ui-ink hover:underline"
      >
        Release notes
        <ArrowUpRightIcon aria-hidden className="size-3" />
      </a>
    </>
  );
}

function CommitDate({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  return (
    <>
      <Dot />
      <span>{ago(date)}</span>
    </>
  );
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
    <SettingsRow
      title={label}
      detail={
        <div className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span
              className={
                version
                  ? "font-[ui-monospace,monospace] text-xs font-semibold text-ui-ink"
                  : "text-ui-soft"
              }
            >
              {version ?? "None yet"}
            </span>
            {details}
          </span>
          {note ? <span className="text-xs text-ui-soft">{note}</span> : null}
        </div>
      }
      action={action}
    />
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
  if (target.status === "current") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ui-soft">
        <CheckIcon aria-hidden className="size-3.5" />
        Installed
      </span>
    );
  }
  if (target.status === "older") {
    return (
      <span className="shrink-0 text-xs text-ui-soft">Yours is newer</span>
    );
  }
  if (!target.installable && target.build === "building") {
    return <span className="shrink-0 text-xs text-ui-soft">Building…</span>;
  }
  if (!target.installable && target.build === "failed") return null;
  if (!target.installable) {
    return (
      <a
        href={target.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-ui-primary underline-offset-4 hover:underline"
      >
        Get the installer
        <ArrowUpRightIcon aria-hidden className="size-3" />
      </a>
    );
  }
  return (
    <Button
      size="sm"
      tone={primary ? "primary" : "soft"}
      disabled={disabled}
      onClick={onUpdate}
    >
      Update
    </Button>
  );
}

function releaseNote(release: UpdateTarget | null | undefined) {
  if (!release || release.installable || release.status !== "newer") {
    return undefined;
  }
  if (release.build === "building") {
    return "Its downloads are still being built, which takes about half an hour. Kazusa lets you know when it’s ready.";
  }
  if (release.build === "failed") {
    return "Its downloads failed to build, so it can’t be installed yet.";
  }
  return undefined;
}

function remaining(download: WorldDownload): string | null {
  if (download.percent < 5 || download.percent >= 100) return null;
  const elapsed = download.updatedAt - download.startedAt;
  const left = (elapsed / download.percent) * (100 - download.percent);
  const minutes = Math.round(left / 60_000);
  if (minutes < 1) return "less than a minute left";
  return minutes === 1
    ? "about a minute left"
    : `about ${minutes} minutes left`;
}

function WorldDownloadBar({
  title,
  download,
}: {
  title: string;
  download: WorldDownload | undefined;
}) {
  const percent = download?.percent ?? 0;
  const status = !download
    ? "Starting…"
    : download.stage === "preparing"
      ? "Getting ready…"
      : download.stage === "updating" || download.stage === "checking"
        ? "Unpacking…"
        : [`${percent}%`, remaining(download)].filter(Boolean).join(" · ");

  return (
    <ProgressBar
      label={`Downloading ${title}`}
      value={download ? percent : null}
      statusText={status}
    />
  );
}

function ProgressNotice({ phase }: { phase: UpdatePhase }) {
  return (
    <Callout
      title={
        phase.step === "downloading"
          ? `Downloading${phase.version ? ` ${phase.version}` : " the update"}…`
          : `Restarting into ${phase.version}…`
      }
    >
      {phase.step === "restarting"
        ? "Characters finish what they’re doing first, so this can take a few minutes. Kazusa’s terminal window shows how it’s going."
        : "Your world stays open while the update downloads."}
    </Callout>
  );
}

function WorldVersion() {
  const { world, worldResource } = useSources();
  const { update, admin, canAsk, asking } = useWorldUpdate();
  const checker = useWorldCheck();
  const [starting, setStarting] = useState(false);
  const credit = world?.package;
  const check = checker.result;

  useEffect(() => {
    void worldResource.mutate();
  }, [worldResource]);

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

  async function handleDownload() {
    setStarting(true);
    try {
      await checker.download();
    } catch (failure) {
      toast.error("Couldn't download it", {
        description: failure instanceof Error ? failure.message : undefined,
      });
    } finally {
      setStarting(false);
    }
  }

  const downloading = check?.downloading === true;
  const download = downloading ? check?.progress : undefined;
  const available = !update && offered(check);
  const failed = check?.lastDownload?.error;
  const yourNote = checker.error ? checker.error.message : undefined;

  return (
    <SettingsSection
      title="World"
      description={`Kazusa checks for new versions of ${credit.name} every hour and asks before downloading. ${admin} brings updates into your world while keeping everything that happened.`}
      action={
        checker.enabled ? (
          <Button
            tone="ghost"
            size="sm"
            pending={checker.checking}
            disabled={downloading}
            icon={<RefreshCwIcon aria-hidden />}
            onClick={() => void handleCheck()}
          >
            Check world
          </Button>
        ) : null
      }
    >
      <SettingsGroup>
        <VersionRow
          label="Your world"
          version={
            check?.current
              ? versionLabel({
                  ...check.current,
                  version: check.current.version ?? credit.version,
                })
              : (credit.version ?? null)
          }
          note={yourNote}
          action={
            update || available || downloading || checker.error ? null : (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ui-soft">
                <CheckIcon aria-hidden className="size-3.5" />
                Up to date
              </span>
            )
          }
        />
        {available && check?.latest ? (
          <VersionRow
            label="New version"
            version={versionLabel(check.latest)}
            details={
              <>
                {check.size ? (
                  <>
                    <Dot />
                    <span>{formatBytes(check.size)}</span>
                  </>
                ) : null}
                <NotesLink url={check.latest.url} />
              </>
            }
            note={
              failed
                ? `The download failed: ${failed}`
                : "Your world plays as usual while it downloads."
            }
            action={
              downloading ? null : (
                <Button
                  tone="primary"
                  size="sm"
                  pending={starting}
                  onClick={() => void handleDownload()}
                >
                  Download
                </Button>
              )
            }
          />
        ) : null}
        {update ? (
          <VersionRow
            label="New version"
            version={versionLabel(update)}
            details={
              <>
                <CommitDate date={update.date} />
                <NotesLink url={update.url} />
              </>
            }
            note={
              canAsk
                ? `Downloaded${reasonOf(update) ? `: ${reasonOf(update)}` : "."} ${admin} will ask a few questions first.`
                : `Ask the world's owner to have ${admin} update it.`
            }
            action={
              canAsk ? (
                <Button
                  tone="primary"
                  size="sm"
                  pending={asking}
                  onClick={openUpdateSaveDialog}
                >
                  Ask {admin}
                </Button>
              ) : null
            }
          />
        ) : null}
      </SettingsGroup>

      {downloading ? (
        <div className="flex flex-col gap-1.5">
          <WorldDownloadBar
            title={`${credit.name} ${check?.latest?.version ?? ""}`.trim()}
            download={download}
          />
          <p className="text-xs text-ui-soft">
            {admin} can update your world once it’s done. Your world plays as
            usual meanwhile.
          </p>
        </div>
      ) : null}
    </SettingsSection>
  );
}

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
      title="Kazusa"
      description="Updating restarts Kazusa. Your world stays as it is."
      action={
        <Button
          tone="ghost"
          size="sm"
          pending={checking}
          disabled={phase !== null}
          icon={<RefreshCwIcon aria-hidden />}
          onClick={() => void check()}
        >
          Check again
        </Button>
      }
    >
      {status?.failed ? (
        <Callout
          tone="danger"
          icon={<CircleAlertIcon />}
          title={`Couldn’t update to ${status.failed.version}`}
        >
          {status.failed.error} This copy and your world are as they were.
        </Callout>
      ) : null}

      {status ? (
        <SettingsGroup>
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
                      <NotesLink url={release.url} />
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
        </SettingsGroup>
      ) : error ? null : (
        <Note>Checking for updates…</Note>
      )}

      {phase ? (
        <ProgressNotice phase={phase} />
      ) : status?.error || error ? (
        <Callout tone="danger">{status?.error ?? error?.message}</Callout>
      ) : status?.blocked ? (
        <Note>{status.blocked}</Note>
      ) : null}
    </SettingsSection>
  );
}

export function UpdateSettings() {
  return (
    <SettingsPage
      title="Updates"
      description="Keep Kazusa and your world up to date."
    >
      <KazusaVersion />
      <WorldVersion />
    </SettingsPage>
  );
}
