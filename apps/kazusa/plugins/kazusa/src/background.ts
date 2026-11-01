import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

type Lifecycle = Pick<OpenClawPluginApi, "lifecycle">;

const CELL = Symbol.for("kazusa.background");

/** Every registration in this process, oldest first. */
function registrations(): Lifecycle[] {
  const holder = globalThis as unknown as Record<
    symbol,
    Lifecycle[] | undefined
  >;
  const list = holder[CELL] ?? [];
  holder[CELL] = list;
  return list;
}

export function rememberRegistration(api: Lifecycle): void {
  registrations().push(api);
}

/**
 * Runs work outside the current caller. A registration made for one turn stops
 * working when that turn's scope closes, and then throws synchronously; from a
 * timer, that would take the Gateway down. So this tries each registration and
 * never throws.
 */
export function inBackground(
  api: Lifecycle | undefined,
  work: () => Promise<unknown>,
  warn: (error: unknown) => void,
): void {
  for (const candidate of [...(api ? [api] : []), ...registrations()]) {
    const started = (() => {
      try {
        return candidate.lifecycle?.runInBackgroundContext?.(work);
      } catch {
        // That registration's scope has closed; try an older one.
        return undefined;
      }
    })();
    if (started) {
      void started.catch((error: unknown) => {
        warn(error);
      });
      return;
    }
  }
  void work().catch((error: unknown) => {
    warn(error);
  });
}
