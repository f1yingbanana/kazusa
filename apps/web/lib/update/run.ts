import { execFile } from "node:child_process";
import path from "node:path";

/**
 * The repository's root: the frontend runs from `apps/web`. Untraced, or
 * Turbopack would watch the whole repository, the live world's state included.
 */
const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), "../..");
const UPDATER = path.join(ROOT, "scripts/update.mjs");

export type UpdaterResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Runs `scripts/update.mjs`, which prints one JSON object, and `{ error }` when
 * it fails. A download can take minutes, so only a check has a time limit.
 */
export function runUpdater(args: readonly string[]): Promise<UpdaterResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [UPDATER, ...args],
      {
        cwd: ROOT,
        maxBuffer: 1024 * 1024,
        timeout: args[0] === "check" ? 60_000 : 0,
      },
      (failure, stdout) => {
        let body: Record<string, unknown> | undefined;
        try {
          body = JSON.parse(stdout) as Record<string, unknown>;
        } catch {
          body = undefined;
        }
        if (!failure && body) resolve({ ok: true, value: body });
        else
          resolve({
            ok: false,
            error:
              typeof body?.error === "string"
                ? body.error
                : (failure?.message ?? "The updater didn't answer."),
          });
      },
    );
  });
}
