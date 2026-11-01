import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPlayerPage, renderPlayerPage, writePlayerAbout } from "./page.ts";

const PLAYER = { id: "user:player", name: "Player" };
const PAGE = `---
character_id: user:player
home: console_room # where they start
name: Player
is_simulated_agent: false
---

# Player

The person this world is being built for.
`;

async function wiki(files: Record<string, string> = { "player.md": PAGE }) {
  const root = await mkdtemp(path.join(tmpdir(), "kazusa-profile-"));
  const dir = path.join(root, "entities", "characters");
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(dir, name), text);
  }
  return { root, dir };
}

describe("renderPlayerPage", () => {
  it("replaces only the body", () => {
    expect(renderPlayerPage(PAGE, PLAYER, "Runs the night shift.")).toBe(
      PAGE.replace(
        "The person this world is being built for.",
        "Runs the night shift.",
      ),
    );
  });

  it("leaves front matter it can't parse alone", () => {
    const broken = "---\nname: [oops\n---\n\n# Player\n\nOld.\n";
    expect(renderPlayerPage(broken, PLAYER, "New.")).toBe(
      "---\nname: [oops\n---\n\n# Player\n\nNew.\n",
    );
  });

  it("starts a page for someone who has none", () => {
    expect(renderPlayerPage(undefined, PLAYER, "")).toBe(
      '---\ncharacter_id: user:player\nname: "Player"\nis_simulated_agent: false\n---\n\n# Player\n',
    );
  });
});

describe("readPlayerPage", () => {
  it("reads the body under the title", async () => {
    const { root } = await wiki();
    const page = await readPlayerPage(root, "user:player");
    expect(page?.about).toBe("The person this world is being built for.");
  });

  it("finds a page by the id it claims", async () => {
    const { root, dir } = await wiki({ "the_teacher.md": PAGE });
    const page = await readPlayerPage(root, "user:player");
    expect(page?.file).toBe(path.join(dir, "the_teacher.md"));
  });

  it("doesn't take a page that belongs to someone else", async () => {
    const { root } = await wiki({
      "mika.md": "---\ncharacter_id: mika\nname: Mika\n---\n\n# Mika\n",
    });
    expect(await readPlayerPage(root, "user:mika")).toBeUndefined();
  });
});

describe("writePlayerAbout", () => {
  it("edits a claimed page in place", async () => {
    const { root, dir } = await wiki({ "the_teacher.md": PAGE });
    await writePlayerAbout(root, PLAYER, "Hi.");
    expect(existsSync(path.join(dir, "player.md"))).toBe(false);
    expect(await readFile(path.join(dir, "the_teacher.md"), "utf8")).toContain(
      "home: console_room # where they start",
    );
  });

  it("creates the page when the wiki has none", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kazusa-profile-"));
    await writePlayerAbout(root, PLAYER, "Hi.");
    const page = await readPlayerPage(root, PLAYER.id);
    expect(page?.about).toBe("Hi.");
  });
});
