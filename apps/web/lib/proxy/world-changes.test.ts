import { beforeEach, describe, expect, it } from "vitest";
import {
  liveChanges,
  noteEvent,
  resetWorldChanges,
  slowChanges,
  watchEvents,
} from "./world-changes";

beforeEach(() => resetWorldChanges());

describe("world changes", () => {
  it("counts every event but a stream's greeting", () => {
    noteEvent("connected");
    expect([liveChanges(), slowChanges()]).toEqual([0, 0]);
    noteEvent("status");
    noteEvent("observed");
    expect([liveChanges(), slowChanges()]).toEqual([2, 0]);
  });

  it("counts an edit for what only an edit changes", () => {
    for (const name of ["places", "world", "write"]) noteEvent(name);
    expect([liveChanges(), slowChanges()]).toEqual([3, 3]);
  });

  it("reads event names off a stream it leaves untouched", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: connected\ndata: {}\n\nev",
      'ent: journal\ndata: {"a":1}\n\n: keepalive\n\nevent: places\ndata: {}\n\n',
    ];
    const passed = watchEvents(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    );
    expect(await new Response(passed).text()).toBe(chunks.join(""));
    // The name split across chunks was still read; the greeting wasn't counted.
    expect([liveChanges(), slowChanges()]).toEqual([2, 1]);
  });
});
