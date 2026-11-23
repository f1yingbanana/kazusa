import { beforeEach, describe, expect, it } from "vitest";
import {
  noteEvent,
  resetWorldChanges,
  watchEvents,
  worldChanges,
} from "./world-changes";

beforeEach(() => resetWorldChanges());

const stream = (chunks: readonly string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

describe("world changes", () => {
  it("counts every event but a stream's greeting", () => {
    noteEvent("connected");
    expect(worldChanges()).toBe(0);
    noteEvent("status");
    noteEvent("write");
    expect(worldChanges()).toBe(2);
  });

  it("reads event names off a stream it leaves untouched", async () => {
    const chunks = [
      "event: connected\ndata: {}\n\nev",
      'ent: journal\ndata: {"a":1}\n\n: keepalive\n\n',
    ];
    expect(await new Response(watchEvents(stream(chunks))).text()).toBe(
      chunks.join(""),
    );
    // The name split across chunks was still read; the greeting wasn't counted.
    expect(worldChanges()).toBe(1);
  });

  it("reads lines however SSE ends them: CRLF, LF or a lone CR", async () => {
    const text = "event: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\revent: c\r";
    // Split so a CRLF straddles two chunks.
    const chunks = [text.slice(0, 9), text.slice(9), "\n"];
    expect(await new Response(watchEvents(stream(chunks))).text()).toBe(
      chunks.join(""),
    );
    expect(worldChanges()).toBe(3);
  });
});
