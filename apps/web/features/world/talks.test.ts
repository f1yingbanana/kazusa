import { describe, expect, it } from "vitest";
import type { ChatInfo } from "@/lib/source/chats/types";
import { rankRooms, talksByPlace } from "./talks";

const huddle = (
  id: string,
  placeId: string | undefined,
  members: string[],
  extra: Partial<ChatInfo> = {},
): ChatInfo => ({ id, name: id, type: "huddle", members, placeId, ...extra });

const self = () => "me";

describe("talksByPlace", () => {
  it("groups talks happening now by place, texts and ended talks left out", () => {
    const mine = [
      huddle("h1", "cafe", ["me", "airi"]),
      { ...huddle("d1", undefined, ["me", "airi"]), type: "direct" as const },
    ];
    const observed = [
      huddle("h2", "cafe", ["noa", "yuuka"]),
      huddle("h3", "hall", ["noa", "yuuka"], { ended: true }),
      huddle("h4", undefined, ["noa", "yuuka"]),
    ];
    const talks = talksByPlace(mine, observed, self, {});
    expect([...talks.keys()]).toEqual(["cafe"]);
    expect(talks.get("cafe")?.map((t) => t.chat.id)).toEqual(["h1", "h2"]);
    expect(talks.get("cafe")?.[0]?.others).toEqual(["airi"]);
  });

  it("isn't a talk when you're alone in yours, or one person stands in another's", () => {
    const talks = talksByPlace(
      [huddle("h1", "cafe", ["me"])],
      [huddle("h2", "cafe", ["noa"])],
      self,
      {},
    );
    expect(talks.size).toBe(0);
  });

  it("lists your own copy once, as yours", () => {
    const yours = huddle("h1", "cafe", ["me", "airi"]);
    const talks = talksByPlace([yours], [yours], self, {});
    expect(talks.get("cafe")).toHaveLength(1);
    expect(talks.get("cafe")?.[0]?.mine).toBe(true);
  });

  it("puts someone speaking first, then yours, then the latest line", () => {
    const at = (timestamp: number) => ({
      lastMessage: { sequence: 1, text: "", timestamp },
    });
    const observed = [
      huddle("quiet-old", "cafe", ["a", "b"], at(1)),
      huddle("quiet-new", "cafe", ["c", "d"], at(5)),
      huddle("speaking", "cafe", ["e", "f"], at(0)),
    ];
    const mine = [huddle("yours", "cafe", ["me", "g"], at(2))];
    const order = talksByPlace(mine, observed, self, { speaking: [{}] })
      .get("cafe")
      ?.map((t) => t.chat.id);
    expect(order).toEqual(["speaking", "yours", "quiet-new", "quiet-old"]);
  });
});

describe("rankRooms", () => {
  const room = (placeId: string, members: number) => ({
    placeId,
    label: placeId,
    members: Array.from({ length: members }),
  });
  const talk = (id: string, placeId: string, timestamp: number) =>
    huddle(id, placeId, ["a", "b"], {
      lastMessage: { sequence: 1, text: "", timestamp },
    });

  it("puts where you are, then speaking, then talking, then the fullest", () => {
    const talks = talksByPlace(
      [],
      [talk("t1", "cafe", 5), talk("t2", "hall", 9), talk("t3", "yard", 1)],
      self,
      {},
    );
    const rooms = [
      room("attic", 9),
      room("cafe", 2),
      room("hall", 2),
      room("yard", 2),
      room("home", 1),
      room("bench", 3),
    ];
    const order = rankRooms(rooms, talks, "home", { t3: [{}] }).map(
      (r) => r.placeId,
    );
    expect(order).toEqual(["home", "yard", "hall", "cafe", "attic", "bench"]);
  });
});
