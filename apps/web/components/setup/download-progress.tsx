"use client";

import { Progress } from "@/components/ui/progress";
import type { WorldDownload } from "@/lib/run-script";

/** Roughly how long is left, once enough has come in to tell. */
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

/** A template's download as git reports it: a bar, a percent, time left. */
export function DownloadProgress({
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
    <div role="status" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">Downloading {title}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {status}
        </span>
      </div>
      <Progress value={percent} aria-label={`Downloading ${title}`} />
    </div>
  );
}
