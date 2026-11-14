import { spawn } from "node:child_process";
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

/** How far a long script has got, as it reports it (`{"progress": …}`). */
export interface ScriptProgress {
  readonly stage: string;
  readonly percent: number;
}

/**
 * Runs one of the repository's `scripts/`, which ends with one JSON object
 * (with `error` when it fails) and may first print `{"progress": …}` lines,
 * handed to `onProgress` as they come. `timeout` 0 waits as long as it takes.
 */
export function runScript(
  script: string,
  args: readonly string[],
  timeout: number,
  onProgress?: (progress: ScriptProgress) => void,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "scripts", script), ...args],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffered = "";
    let body: Record<string, unknown> | undefined;
    let stderr = "";
    const take = (line: string) => {
      if (!line.trim()) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (parsed.progress && typeof parsed.progress === "object")
        onProgress?.(parsed.progress as ScriptProgress);
      else body = parsed;
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) take(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const timer = timeout
      ? setTimeout(() => child.kill("SIGTERM"), timeout)
      : undefined;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      take(buffered);
      if (code === 0 && body) resolve({ ok: true, value: body });
      else
        resolve({
          ok: false,
          error:
            typeof body?.error === "string"
              ? body.error
              : stderr.trim() || `${script} didn't answer.`,
        });
    });
  });
}
