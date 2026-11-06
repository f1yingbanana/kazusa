import { execFile } from "node:child_process";
import path from "node:path";

/**
 * The repository's root: the frontend runs from `apps/web`. Untraced, or
 * Turbopack would watch the whole repository, the live world's state included.
 */
export const ROOT = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  "../..",
);

export type ScriptResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Runs one of the repository's `scripts/`, which prints one JSON object (with
 * `error` when it fails). `timeout` 0 waits as long as it takes.
 */
export function runScript(
  script: string,
  args: readonly string[],
  timeout: number,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, "scripts", script), ...args],
      { cwd: ROOT, maxBuffer: 1024 * 1024, timeout },
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
                : (failure?.message ?? `${script} didn't answer.`),
          });
      },
    );
  });
}
