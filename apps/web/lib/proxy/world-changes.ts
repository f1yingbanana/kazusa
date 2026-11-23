/**
 * How many times the world has changed, as far as this server has seen. What a
 * visitor reads is kept in Next's cache under the count it was read at
 * (`visitor-read.ts`), so a change makes every later read a new one.
 *
 * The world says when it changes: every event stream to a browser passes
 * through this server, and each event on any of them counts. A browser that
 * refetches because of an event therefore asks under a later count than
 * anything read before that event. `revalidateTag` can't do this job: it only
 * takes effect from inside a request, and a stream outlives the request that
 * opened it (tried, 16.4.6: it neither throws nor invalidates).
 */
const changes = { live: 0, slow: 0 };

/** Events that announce an edit to what is kept as `slow`. */
const EDIT_EVENTS: ReadonlySet<string> = new Set(["places", "world", "write"]);

/**
 * The world changed: an event on a browser's stream, or a write through this
 * server (`"write"`). `connected` is a stream's own greeting, not a change, so
 * a crowd arriving doesn't end what it is about to read.
 */
export function noteEvent(name: string): void {
  if (name === "connected") return;
  changes.live += 1;
  if (EDIT_EVENTS.has(name)) changes.slow += 1;
}

/** The count that what changes with anything is read under. */
export function liveChanges(): number {
  return changes.live;
}

/** The count that what only an edit changes (the map, pages) is read under. */
export function slowChanges(): number {
  return changes.slow;
}

/**
 * Passes an event stream through untouched while counting each event. A name
 * split across chunks is still read, and lines may end as SSE allows: CRLF, LF
 * or a lone CR.
 */
export function watchEvents(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let tail = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        const lines = (tail + decoder.decode(chunk, { stream: true })).split(
          /\r\n|\r|\n/,
        );
        tail = lines.pop() ?? "";
        for (const line of lines)
          if (line.startsWith("event:")) noteEvent(line.slice(6).trim());
      },
    }),
  );
}

/** For tests: no changes seen. */
export function resetWorldChanges(): void {
  changes.live = 0;
  changes.slow = 0;
}
