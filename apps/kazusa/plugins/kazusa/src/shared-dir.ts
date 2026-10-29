import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `apps/kazusa/shared/<name>`. The Gateway runs from `apps/kazusa`, and
 * OpenClaw may load this plugin from a copied build under its state directory,
 * where the source tree is not beside it; the source tree is the fallback
 * (tests, other working directories).
 */
export function sharedDir(name: string): string {
  const fromCwd = path.resolve("shared", name);
  if (existsSync(fromCwd)) return fromCwd;
  return fileURLToPath(new URL(`../../../shared/${name}`, import.meta.url));
}
