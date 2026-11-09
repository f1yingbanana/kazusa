import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

/** A folder to watch and which paths under it are skills. */
export interface SkillRoot {
  readonly dir: string;
  /** Matches a changed path relative to `dir`. */
  readonly skills: RegExp;
}

/**
 * A skills folder, watched from the folder it is in, so it may be created or
 * removed while the Gateway runs.
 */
export function skillsFolder(dir: string): SkillRoot {
  const name = path.basename(dir).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return {
    dir: path.dirname(dir),
    skills: new RegExp(`^${name}(?:[\\\\/]|$)`, "u"),
  };
}

/**
 * `<character>/skills/…` or `<character>/.agents/skills/…` under the workspaces
 * folder.
 */
export const CHARACTER_SKILLS =
  /^[^\\/]+[\\/](?:\.agents[\\/])?skills(?:[\\/]|$)/;

/** Edits arrive as bursts of events: one change per burst. */
const SETTLE_MS = 300;

interface WatchCell {
  key: string;
  watchers: FSWatcher[];
  settling?: NodeJS.Timeout;
  onChange: () => void;
}

const CELL = Symbol.for("kazusa.skillsWatch");

/**
 * Calls `onChange` once a burst of skill edits settles. One recursive watcher
 * per folder for the whole process, however many characters there are: a single
 * native stream on macOS and Windows, which Kazusa ships for (Linux, for
 * development, watches each folder under it). OpenClaw's own
 * `skills.load.watch` watches each workspace and runs out with a large cast.
 * The plugin registers many times; the newest `onChange` is the one called.
 */
export function watchSkills(
  roots: readonly SkillRoot[],
  onChange: () => void,
  warn: (message: string) => void,
  settleMs: number = SETTLE_MS,
): void {
  const holder = globalThis as { [CELL]?: WatchCell };
  const unique = new Map(
    roots.map((root) => [`${root.dir}\0${root.skills.source}`, root]),
  );
  const key = JSON.stringify([...unique.keys()]);
  const existing = holder[CELL];
  if (existing?.key === key) {
    existing.onChange = onChange;
    return;
  }
  if (existing) stopWatchingSkills();
  const cell: WatchCell = { key, watchers: [], onChange };
  holder[CELL] = cell;
  for (const { dir, skills } of unique.values()) {
    if (!existsSync(dir)) continue;
    try {
      cell.watchers.push(
        watch(dir, { recursive: true, persistent: false }, (_event, file) => {
          if (file && !skills.test(file)) return;
          clearTimeout(cell.settling);
          cell.settling = setTimeout(() => cell.onChange(), settleMs);
        }).on("error", (error) => {
          warn(`Kazusa skills: stopped watching ${dir}: ${String(error)}`);
        }),
      );
    } catch (error: unknown) {
      warn(`Kazusa skills: can't watch ${dir}: ${String(error)}`);
    }
  }
}

/** Closes the process's skill watchers. */
export function stopWatchingSkills(): void {
  const holder = globalThis as { [CELL]?: WatchCell };
  const cell = holder[CELL];
  if (!cell) return;
  clearTimeout(cell.settling);
  for (const watcher of cell.watchers) watcher.close();
  delete holder[CELL];
}
