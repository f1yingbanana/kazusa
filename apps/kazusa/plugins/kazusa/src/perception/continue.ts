/**
 * The system agent's long jobs outlast one brain run, and past runs are not
 * replayed. `continue_work` asks for a fresh run once this one has ended. One
 * cell per process: tools and hooks can run on different registrations.
 */
interface Continuation {
  /** Asked for by the run under way. */
  note?: string;
  /** Runs asked for since a person last spoke to them. */
  count: number;
}

const CELL = Symbol.for("kazusa.perception.continuations");

function cell(): Map<string, Continuation> {
  const scope = globalThis as { [CELL]?: Map<string, Continuation> };
  return (scope[CELL] ??= new Map<string, Continuation>());
}

/** False once `limit` runs have gone by without anyone saying a word. */
export function requestContinuation(
  agentId: string,
  note: string,
  limit: number,
): boolean {
  const entry = cell().get(agentId) ?? { count: 0 };
  cell().set(agentId, entry);
  if (entry.note !== undefined) {
    entry.note = note;
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  entry.note = note;
  return true;
}

/** The note this run left, once. */
export function takeContinuation(agentId: string): string | undefined {
  const entry = cell().get(agentId);
  const note = entry?.note;
  if (entry) delete entry.note;
  return note;
}

/** A person spoke: the leash starts over, and a request still stands. */
export function resetContinuations(agentId: string): void {
  const entry = cell().get(agentId);
  if (entry) entry.count = 0;
}
