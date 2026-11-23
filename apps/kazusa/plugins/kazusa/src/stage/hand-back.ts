import { formatSimTime } from "../context-engine/format.ts";
import { heardAs } from "../messaging/conversations.ts";
import type { LogWindow } from "../messaging/message-database.ts";
import type { MessageDelivery } from "../messaging/messaging.ts";
import { personLabel } from "../person-label.ts";

/** What of a long play a look back shows, newest kept. */
const PLAYED_CHARS = 8_000;

export interface HandBackDeps {
  readonly messageLog: (window: LogWindow) => Promise<MessageDelivery[]>;
  readonly nameOf: (id: string) => Promise<string>;
  readonly time: () => number;
  /** Whether they went anywhere since. */
  readonly movedSince: (id: string, since: number) => Promise<boolean>;
  readonly idleWake: (id: string) => Promise<void>;
  /** The by-hand night that goes over it, with `lines` when they are needed. */
  readonly lookBack: (id: string, lines?: string) => Promise<void>;
  /**
   * How far back a character's records surely reach, in ms: their records
   * window less one step of its grid. Played longer, a look back is shown what
   * was said as them.
   */
  readonly recordsReachMs: number;
}

/**
 * Their model again. When the person said or did something as them, a turn to
 * look back on it and keep what matters, the way they would have as it
 * happened; otherwise only a check-in to choose what's next.
 */
export function createHandBack(
  deps: HandBackDeps,
): (id: string, since: number) => Promise<void> {
  /** What the person said as them since, oldest first. */
  const saidAs = async (id: string, since: number) =>
    (
      await deps.messageLog({ after: since - 1, limit: 500, actors: [id] })
    ).filter((delivery) => delivery.sender === id && delivery.byPlayer);

  /** Who it went to and what, the latest that fit. */
  const lines = async (
    id: string,
    said: readonly MessageDelivery[],
  ): Promise<string> => {
    const names = new Map<string, string>();
    const label = async (who: string) => {
      if (!names.has(who))
        names.set(who, personLabel(await deps.nameOf(who), who));
      return names.get(who)!;
    };
    const all: string[] = [];
    for (const delivery of [...said].sort(
      (a, b) => a.timestamp - b.timestamp,
    )) {
      const to = await Promise.all(
        delivery.audience.filter((who) => who !== id).map(label),
      );
      all.push(
        `- [${formatSimTime(delivery.timestamp)}] to ${to.join(", ")}: ${heardAs(delivery.params)}`,
      );
    }
    let text = "";
    for (const line of all.reverse()) {
      if (text.length + line.length > PLAYED_CHARS) break;
      text = text ? `${line}\n${text}` : line;
    }
    return text;
  };

  return async (id, since) => {
    const said = await saidAs(id, since);
    if (!said.length && !(await deps.movedSince(id, since))) {
      await deps.idleWake(id);
      return;
    }
    const long = deps.time() - since > deps.recordsReachMs;
    const shown = long && said.length ? await lines(id, said) : "";
    await deps.lookBack(id, shown || undefined);
  };
}
