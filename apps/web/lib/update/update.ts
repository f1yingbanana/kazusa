import { z } from "zod";

/**
 * Settings → Updates. `scripts/update.mjs` does the work, through this app's
 * local `/update` route, so it updates the copy of Kazusa this frontend runs
 * from: never a Gateway elsewhere.
 */
const UpdateTargetSchema = z.object({
  version: z.string(),
  date: z.string(),
  url: z.string(),
  /**
   * False when it has no download for this system, as releases before in-app
   * updates don't, and as `main` doesn't for an installer's copy.
   */
  installable: z.boolean(),
  /** Against this copy: whether moving to it goes forward. */
  status: z.enum(["newer", "current", "older", "unknown"]),
  /** Commits it has that this copy doesn't. */
  changes: z.number().nullable(),
});

export const UpdateStatusSchema = z.object({
  current: z.object({
    /** Null when this copy can't tell, like GitHub's source zip. */
    version: z.string().nullable(),
    /** The git branch, for a clone that is on one. */
    branch: z.string().nullable(),
  }),
  release: UpdateTargetSchema.nullable(),
  /** The latest `main`. */
  development: UpdateTargetSchema.nullable(),
  /** Why this copy can't update itself, if it can't. */
  blocked: z.string().nullable(),
  /** The last update, if it didn't finish. */
  failed: z.object({ version: z.string(), error: z.string() }).nullable(),
  /** Why GitHub couldn't be checked. */
  error: z.string().nullable(),
  /**
   * Changes when the frontend restarts, which is how the page knows an update
   * ran.
   */
  boot: z.string(),
  /** An update is downloading, from this page or another. */
  staging: z.boolean(),
});

export type UpdateTarget = z.infer<typeof UpdateTargetSchema>;
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type UpdateChannel = "release" | "development";

const ErrorSchema = z.object({ error: z.string() });
const BootSchema = z.object({ boot: z.string() });
const StagedSchema = z.object({ version: z.string() });

async function read(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new Error(ErrorSchema.safeParse(body).data?.error ?? fallback);
}

/** `fresh` skips the route's short cache of GitHub's answers. */
export async function fetchUpdateStatus(fresh = false): Promise<UpdateStatus> {
  const response = await fetch(fresh ? "/update?fresh=1" : "/update", {
    cache: "no-store",
  });
  return UpdateStatusSchema.parse(
    await read(response, "Couldn't check for updates."),
  );
}

export async function fetchBoot(): Promise<string> {
  const response = await fetch("/update?boot=1", { cache: "no-store" });
  return BootSchema.parse(await read(response, "No answer yet.")).boot;
}

/**
 * Downloads the update and leaves it for Kazusa to apply as it restarts.
 * Resolves with the version it moves to.
 */
export async function startUpdate(to: UpdateChannel): Promise<string> {
  const response = await fetch("/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  return StagedSchema.parse(await read(response, "Couldn't update.")).version;
}
