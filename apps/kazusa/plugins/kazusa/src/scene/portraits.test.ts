import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStickers } from "../stickers/stickers.ts";
import { defaultPortraitUrl, readPortraits } from "./portraits.ts";

async function workspaceWith(
  files: readonly string[],
  manifests: { portraits?: unknown; stickers?: unknown } = {},
): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "kazusa-portraits-"));
  const dir = path.join(workspace, "portraits");
  await mkdir(dir);
  for (const file of files) await writeFile(path.join(dir, file), file);
  for (const [kind, manifest] of Object.entries(manifests)) {
    await mkdir(path.join(workspace, kind), { recursive: true });
    await writeFile(
      path.join(workspace, kind, `${kind}.json`),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  }
  return workspace;
}

describe("portrait sets", () => {
  it("names outfits and moods by the stickers' vocabulary", async () => {
    const workspace = await workspaceWith(
      [
        "happy.webp",
        "eyes-closed.png",
        "gym-happy.webp",
        "gym.webp",
        "Bad Name.webp",
        "figure.svg",
      ],
      {
        portraits: {
          size: [820, 1640],
          eyeline: 0.21,
          placement: {
            "": { centre: 0.4 },
            gym: { centre: 0.6, floor: 0.95, eyes: 0.2, scale: 0.8 },
            "gym-happy": { offset: [10, -20] },
            happy: { centre: 7, scale: 0 },
          },
        },
        stickers: { outfits: { gym: "a gym uniform" } },
      },
    );
    const set = readPortraits(workspace);
    expect([...set.portraits.keys()]).toEqual([
      "eyes-closed",
      "gym-happy",
      "gym",
      "happy",
    ]);
    expect(set.portraits.get("gym-happy")).toMatchObject({
      outfit: "gym",
      mood: "happy",
      contentType: "image/webp",
    });
    // An undeclared first word, or an outfit word alone, is all mood.
    expect(set.portraits.get("eyes-closed")).toMatchObject({
      mood: "eyes-closed",
    });
    expect(set.portraits.get("eyes-closed")).not.toHaveProperty("outfit");
    expect(set.portraits.get("gym")).toMatchObject({ mood: "gym" });
    // Placement: by outfit ("" without one); one picture's own entry wins
    // whole; bad fields are dropped, and an entry left empty with them.
    expect(set.portraits.get("eyes-closed")?.placement).toEqual({
      centre: 0.4,
    });
    expect(set.portraits.get("gym")?.placement).toEqual({
      centre: 0.6,
      floor: 0.95,
      eyes: 0.2,
      scale: 0.8,
    });
    expect(set.portraits.get("gym-happy")?.placement).toEqual({
      offset: [10, -20],
    });
    expect(set.portraits.get("happy")).not.toHaveProperty("placement");
    expect(set).toMatchObject({
      default: "happy",
      size: [820, 1640],
      eyeline: 0.21,
    });
  });

  it("rests in the usual clothes, neutral or else a calm face", async () => {
    const outfits = { stickers: { outfits: { swim: "a swimsuit" } } };
    const rest = async (files: string[]) => {
      const workspace = await workspaceWith(files, outfits);
      return {
        set: readPortraits(workspace).default,
        roster: defaultPortraitUrl("aris", workspace)?.match(
          /name=([\w-]+)/,
        )?.[1],
      };
    };
    expect(await rest(["angry.webp", "neutral.webp"])).toEqual({
      set: "neutral",
      roster: "neutral",
    });
    // No neutral: a calm face, never angry for being first by name.
    expect(await rest(["angry.webp", "happy.webp", "content.webp"])).toEqual({
      set: "content",
      roster: "content",
    });
    expect(await rest(["angry.webp", "teary.webp"])).toEqual({
      set: "angry",
      roster: "angry",
    });
    // An outfit is never worn at rest, even one first by name.
    expect(await rest(["angry.webp", "swim-neutral.webp"])).toEqual({
      set: "angry",
      roster: "angry",
    });
    // Only outfits: not drawn.
    expect(await rest(["swim-neutral.webp", "swim-happy.webp"])).toEqual({
      set: undefined,
      roster: undefined,
    });
  });

  it("keeps the pictures when the manifest is broken, field by field", async () => {
    const broken = await workspaceWith(["happy.webp"], {
      portraits: "{ not json",
      stickers: "nor this",
    });
    expect(readPortraits(broken)).toMatchObject({ default: "happy" });
    expect(readPortraits(broken)).not.toHaveProperty("eyeline");
    const half = await workspaceWith(["happy.webp"], {
      portraits: { size: [0, "tall"], eyeline: 0.3 },
    });
    expect(readPortraits(half)).not.toHaveProperty("size");
    expect(readPortraits(half).eyeline).toBe(0.3);
  });

  it("is empty without a folder, and leaves stickers as they were", async () => {
    const none = await mkdtemp(path.join(tmpdir(), "kazusa-portraits-"));
    expect(readPortraits(none)).toEqual({ portraits: new Map() });
    expect(defaultPortraitUrl("aris", none)).toBeUndefined();
    await mkdir(path.join(none, "stickers"));
    await writeFile(path.join(none, "stickers", "maid-shy.webp"), "shy");
    await writeFile(
      path.join(none, "stickers", "stickers.json"),
      JSON.stringify({ outfits: { maid: "a maid dress" } }),
    );
    expect(readStickers(none).stickers.get("maid-shy")).toMatchObject({
      look: "shy",
      outfit: "a maid dress",
    });
  });
});

describe("the default portrait's URL", () => {
  it("follows the default without listing an unchanged folder", async () => {
    const workspace = await workspaceWith(["smile.webp"]);
    const dir = path.join(workspace, "portraits");
    const first = defaultPortraitUrl("aris", workspace);
    expect(first).toMatch(/^\/kazusa\/portrait\?id=aris&name=smile&v=\w+$/);
    expect(readPortraits(workspace).default).toBe("smile");

    // Replaced in place: the folder is the same, the version is not.
    const later = new Date(Date.now() + 60_000);
    await writeFile(path.join(dir, "smile.webp"), "new smile");
    await utimes(path.join(dir, "smile.webp"), later, later);
    const replaced = defaultPortraitUrl("aris", workspace);
    expect(replaced).toContain("name=smile");
    expect(replaced).not.toBe(first);

    // A neutral look arrives: the folder changed, so it is listed again.
    await writeFile(path.join(dir, "neutral.webp"), "neutral");
    const folderLater = new Date(Date.now() + 120_000);
    await utimes(dir, folderLater, folderLater);
    expect(defaultPortraitUrl("aris", workspace)).toContain("name=neutral");

    await rm(path.join(dir, "neutral.webp"));
    await rm(path.join(dir, "smile.webp"));
    const emptied = new Date(Date.now() + 180_000);
    await utimes(dir, emptied, emptied);
    expect(defaultPortraitUrl("aris", workspace)).toBeUndefined();
  });
});
