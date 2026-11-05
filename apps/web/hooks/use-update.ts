"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import {
  announcedRelease,
  fetchBoot,
  fetchUpdateStatus,
  startUpdate,
  type UpdateChannel,
  type UpdateStatus,
  type UpdateTarget,
} from "@/lib/update/update";

const UPDATE_KEY = "update";
const BOOT_KEY = "update/boot";
const RESTART_POLL_MS = 2_000;
/** A check costs up to five of GitHub's 60 unauthenticated calls an hour. */
const BACKGROUND_CHECK_MS = 60 * 60_000;
/** A release's downloads take about half an hour to build. */
const BUILDING_CHECK_MS = 10 * 60_000;

export type UpdatePhase =
  | { readonly step: "downloading"; readonly version: string | null }
  | {
      readonly step: "restarting";
      readonly version: string;
      readonly boot: string;
    };

/**
 * This copy's version against the latest release and `main`, and moving to
 * either. Once the update is downloaded Kazusa restarts, and the page reloads
 * when the frontend is back.
 */
export function useUpdate() {
  const [phase, setPhase] = useState<UpdatePhase | null>(null);
  const [checking, setChecking] = useState(false);
  // The boot of a frontend another page's update will restart.
  const [othersBoot, setOthersBoot] = useState<string | null>(null);
  // Each check spends GitHub's hourly allowance, so beyond the background
  // check (`useAnnouncedRelease`) only on request. While another page
  // downloads, the route answers from its cache.
  const resource = useSWR<UpdateStatus, Error>(
    UPDATE_KEY,
    () => fetchUpdateStatus(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: (data) => (data?.staging ? RESTART_POLL_MS : 0),
      onSuccess: (data) => {
        if (data.staging) setOthersBoot((boot) => boot ?? data.boot);
      },
    },
  );
  const { mutate } = resource;
  const restarting = phase?.step === "restarting" ? phase : null;
  const watchedBoot = restarting?.boot ?? othersBoot;

  useSWR(watchedBoot ? [BOOT_KEY, watchedBoot] : null, () => fetchBoot(), {
    refreshInterval: RESTART_POLL_MS,
    // Kazusa can take minutes to stop, and SWR's backoff would add as many.
    onErrorRetry: (_error, _key, _config, revalidate, options) => {
      setTimeout(() => void revalidate(options), RESTART_POLL_MS);
    },
    revalidateOnFocus: false,
    dedupingInterval: 0,
    onSuccess: (boot) => {
      if (watchedBoot && boot !== watchedBoot) window.location.reload();
    },
  });

  const check = useCallback(async () => {
    setChecking(true);
    try {
      await mutate(fetchUpdateStatus(true), { revalidate: false });
    } catch {
      // SWR keeps the error for the page to show.
    } finally {
      setChecking(false);
    }
  }, [mutate]);

  /** Throws if it couldn't start, so the page can say why. */
  const update = useCallback(
    async (to: UpdateChannel): Promise<void> => {
      const status = resource.data;
      if (!status) return;
      const version = status[to]?.version ?? null;
      setPhase({ step: "downloading", version });
      try {
        const staged = await startUpdate(to);
        setPhase({ step: "restarting", version: staged, boot: status.boot });
      } catch (error) {
        // The connection drops when Kazusa stops for the update.
        if (error instanceof TypeError && version) {
          setPhase({ step: "restarting", version, boot: status.boot });
          return;
        }
        setPhase(null);
        void mutate();
        throw error;
      }
    },
    [mutate, resource.data],
  );

  return {
    status: resource.data,
    error: resource.error,
    checking,
    /** Another page's download counts too. */
    phase:
      phase ??
      (resource.data?.staging
        ? ({ step: "downloading", version: null } as const)
        : null),
    check,
    update,
  };
}

/**
 * Checks for a new release in the background: hourly, and more often while the
 * latest one's downloads build, so it's announced soon after they're up. Shares
 * its answer with Settings → Updates.
 */
export function useAnnouncedRelease(): UpdateTarget | null {
  const { data } = useSWR<UpdateStatus, Error>(
    UPDATE_KEY,
    () => fetchUpdateStatus(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // The next background check is soon enough.
      shouldRetryOnError: false,
      refreshInterval: (status) =>
        status?.release?.build === "building"
          ? BUILDING_CHECK_MS
          : BACKGROUND_CHECK_MS,
    },
  );
  return data ? announcedRelease(data) : null;
}
