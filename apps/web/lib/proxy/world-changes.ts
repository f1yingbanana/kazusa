/**
 * How many times the world has changed, as far as this server has seen: part of
 * the key a visitor's read is cached under (`visitor-read.ts`), so a change
 * makes every later read a new one.
 *
 * Every event stream to a browser passes through this server, and each event on
 * any of them counts, so a browser that refetches because of an event never
 * gets the answer from before it. Next's own invalidation can't do this:
 * `revalidateTag` only takes effect inside a request, and a stream outlives the
 * request that opened it.
 */
let changes = 0;

/**
 * The world changed: an event on a browser's stream, or a write through this
 * server. `connected` is a stream's greeting, not a change, so a crowd arriving
 * doesn't end what it is about to read.
 */
export function noteEvent(name: string): void {
  if (name !== "connected") changes += 1;
}

export function worldChanges(): number {
  return changes;
}

/**
 * Passes an event stream through untouched while counting its events. A name
 * split across chunks is still read, and lines may end as SSE allows.
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
  changes = 0;
}
