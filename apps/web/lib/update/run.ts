import { runScript, type ScriptResult } from "../run-script";

export type UpdaterResult = ScriptResult;

/**
 * Runs `scripts/update.mjs`. A download can take minutes, so only a check has a
 * time limit.
 */
export function runUpdater(args: readonly string[]): Promise<UpdaterResult> {
  return runScript("update.mjs", args, args[0] === "check" ? 60_000 : 0);
}
