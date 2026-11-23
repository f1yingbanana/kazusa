import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";

/**
 * One change to a world's data that a Kazusa release needs, run once per world
 * when the Gateway starts. Each lives in its own file named for the pull
 * request that needed it (`0082-play-as.ts` is #82), so it is plain which
 * change each one serves; they run in that order.
 */
export interface Migration {
  /** `NNNN-name`: the pull request's number, then what it is for. */
  readonly id: string;
  /** What it did, for the log; nothing when there was nothing to do. */
  readonly run: () => Promise<string | undefined>;
}

/** When each migration ran, by id, in the `"migrations"` store. */
export interface MigrationRecord {
  readonly at: number;
  readonly did?: string;
}

/**
 * Runs, in order, every migration this world hasn't had yet, and remembers each
 * that finished. One that fails is said and tried again on the next start; the
 * ones after it wait, since they may build on it.
 */
export async function runMigrations(
  migrations: readonly Migration[],
  store: StateStore<MigrationRecord>,
  log: Pick<OpenClawPluginApi["logger"], "info" | "warn">,
  now: () => number = Date.now,
): Promise<void> {
  for (const migration of [...migrations].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (await store.lookup(migration.id)) continue;
    let did: string | undefined;
    try {
      did = await migration.run();
    } catch (error) {
      log.warn(`Migration ${migration.id} failed: ${String(error)}`);
      return;
    }
    await store.register(migration.id, {
      at: now(),
      ...(did ? { did } : {}),
    });
    if (did) log.info(`Migration ${migration.id}: ${did}`);
  }
}
