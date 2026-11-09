import os from "node:os";
import path from "node:path";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandUserPath(
  rawPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("~")) return trimmed;
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  return trimmed.replace(/^~(?=$|[\\/])/u, () => home);
}

/** Expand the home directory and resolve a relative path against `baseDir`. */
export function resolveUserPath(
  rawPath: string,
  baseDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(baseDir, expandUserPath(rawPath, env));
}

/** OpenClaw's state directory: `OPENCLAW_STATE_DIR`, else `~/.openclaw`. */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string {
  const custom = env.OPENCLAW_STATE_DIR?.trim();
  if (custom) return resolveUserPath(custom, process.cwd(), env);
  return path.join(homedir, ".openclaw");
}
