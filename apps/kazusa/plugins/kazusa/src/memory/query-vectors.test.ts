import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  queryVectorFor,
  queryVectorStats,
  resetQueryVectors,
} from "./register.ts";

const embedder = { model: "text-embedding-3-small" };
const vectorOf = (text: string) => Float32Array.from([text.length]);

describe("query embeddings started at handoff", () => {
  beforeEach(resetQueryVectors);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a turn the embedding warm started, once", async () => {
    const embed = vi.fn(async (text: string) => vectorOf(text));
    const warmed = queryVectorFor(embedder, "Want ice cream?", true, embed);
    const used = await queryVectorFor(
      embedder,
      "Want ice cream?",
      false,
      embed,
    );
    expect(used).toEqual(await warmed);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(queryVectorStats()).toMatchObject({
      warmed: 1,
      hits: 1,
      misses: 0,
      wasted: 0,
      entries: 1,
    });
  });

  it("embeds again for other words or another model", async () => {
    const embed = vi.fn(async (text: string) => vectorOf(text));
    await queryVectorFor(embedder, "Want ice cream?", true, embed);
    await queryVectorFor(embedder, "Want cake?", false, embed);
    await queryVectorFor({ model: "other" }, "Want ice cream?", false, embed);
    expect(embed).toHaveBeenCalledTimes(3);
    expect(queryVectorStats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it("forgets a failed embedding, so the turn asks again", async () => {
    const embed = vi
      .fn<(text: string) => Promise<Float32Array | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(vectorOf("x"));
    expect(await queryVectorFor(embedder, "Hi?", true, embed)).toBeUndefined();
    expect(await queryVectorFor(embedder, "Hi?", false, embed)).toEqual(
      vectorOf("x"),
    );
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("counts a warmed embedding no turn used as wasted once it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const embed = vi.fn(async (text: string) => vectorOf(text));
    await queryVectorFor(embedder, "Ignored line", true, embed);
    vi.setSystemTime(121_000);
    await queryVectorFor(embedder, "Later line", false, embed);
    expect(queryVectorStats()).toMatchObject({
      warmed: 1,
      wasted: 1,
      entries: 1,
    });
  });

  it("keeps at most 256", async () => {
    const embed = vi.fn(async (text: string) => vectorOf(text));
    for (let i = 0; i < 300; i++)
      await queryVectorFor(embedder, `line ${i}`, false, embed);
    expect(queryVectorStats().entries).toBe(256);
  });
});
