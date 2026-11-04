import { describe, expect, it } from "vitest";
import {
  activation,
  createFamiliarity,
  usesOfMessage,
  withUse,
  type FamiliarityRecord,
} from "./familiarity.ts";
import type { Page } from "./page.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-23T12:00:00Z");
const config = { decay: 0.5, recent: 4, episodeHours: 24 };

function memoryStore() {
  const values = new Map<string, FamiliarityRecord>();
  return {
    lookup: async (key: string) => values.get(key),
    register: async (key: string, value: FamiliarityRecord) => {
      values.set(key, value);
    },
    entries: async () => [],
  };
}

const page = (id: string, seen?: string): Page =>
  ({
    id,
    kind: "person",
    notes: [],
    ...(seen ? { seen } : {}),
  }) as unknown as Page;

describe("familiarity", () => {
  it("counts one use a day, timed at that day's latest contact", () => {
    let record: FamiliarityRecord = {};
    record = withUse(record, "natsu", NOW, config);
    // Messages minutes apart change nothing worth a write.
    expect(withUse(record, "natsu", NOW + 5 * 60_000, config)).toBe(record);
    // Later the same day: still one use, now as recent as the last chat.
    record = withUse(record, "natsu", NOW + 9 * HOUR, config);
    expect(record.natsu).toMatchObject({ count: 1, recent: [NOW + 9 * HOUR] });
    // The next day is a use of its own.
    record = withUse(record, "natsu", NOW + 25 * HOUR, config);
    expect(record.natsu?.count).toBe(2);
  });

  it("keeps only the latest uses and estimates the rest from the count", () => {
    let record: FamiliarityRecord = {};
    for (let day = 0; day < 10; day++)
      record = withUse(record, "home", NOW + day * 24 * HOUR, config);
    expect(record.home).toMatchObject({
      count: 10,
      first: NOW,
      recent: [6, 7, 8, 9].map((day) => NOW + day * 24 * HOUR),
    });
  });

  it("ranks the recent above the old, and the frequent above the once", () => {
    const at = (hoursAgo: number) => NOW - hoursAgo * HOUR;
    const once = (hoursAgo: number) => ({
      recent: [at(hoursAgo)],
      count: 1,
      first: at(hoursAgo),
      since: at(hoursAgo),
    });
    expect(activation(once(1), NOW, 0.5)).toBeGreaterThan(
      activation(once(48), NOW, 0.5),
    );
    const daily = {
      recent: [at(72), at(48), at(24), at(2)],
      count: 10,
      first: at(240),
      since: at(2),
    };
    // Home, every day for ten days, beats a place seen once an hour ago.
    expect(activation(daily, NOW, 0.5)).toBeGreaterThan(
      activation(once(1), NOW, 0.5),
    );
  });

  it("makes the sender familiar to each recipient, and a small chat to the sender", () => {
    expect(usesOfMessage("natsu", ["natsu", "kazusa", "user:sensei"])).toEqual([
      ["kazusa", ["natsu"]],
      ["natsu", ["kazusa", "user:sensei"]],
    ]);
    // Posting to a big group isn't talking with each of them.
    const crowd = Array.from({ length: 8 }, (_, index) => `c${index}`);
    expect(usesOfMessage("natsu", ["natsu", ...crowd])).toHaveLength(8);
  });

  it("scores what they did, and their own pages by when they last moved", async () => {
    const familiarity = createFamiliarity(memoryStore(), config);
    await familiarity.use("kazusa", ["user:sensei", "kazusa"], NOW - HOUR);
    const scores = await familiarity.scores("kazusa", NOW, [
      page("natsu", "2026-10-20"),
      page("sensei"),
      page("airi"),
    ]);
    // The player is filed under their page id; nobody counts themselves.
    expect([...scores.keys()].sort()).toEqual(["natsu", "sensei"]);
    expect(scores.get("sensei")).toBeGreaterThan(scores.get("natsu") ?? 0);
  });
});
