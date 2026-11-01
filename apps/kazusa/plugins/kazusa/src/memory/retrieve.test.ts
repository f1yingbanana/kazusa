import { ONLY_WHAT_YOU_KNOW } from "../turn.ts";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryIndex } from "./index.ts";
import { renderOnYourMind, renderRoster } from "./render.ts";
import { brainRequest, retrieve, sendersOf, spokenText } from "./retrieve.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
let root: string;
let index: MemoryIndex;

const write = (relative: string, content: string): void => {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
};
const ids = (stimulus: string, seeds: string[] = [], agentId = "kazusa") =>
  retrieve(index, { agentId, stimulus, seeds, now: NOW }).map(({ id }) => id);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kazusa-memory-"));
  write(
    "world/concepts/trinity.md",
    "---\ncommunity: kivotos\naliases: [Trinity General School]\n---\n# Trinity\n\nThe school of tea.\n",
  );
  write(
    "world/concepts/kivotos.md",
    "---\nrenown: famous\n---\n# Kivotos\n\nA city.\n",
  );
  write(
    "world/concepts/gehenna.md",
    "---\ncommunity: kivotos\nrenown: known\n---\n# Gehenna\n\nRowdy school.\n",
  );
  write(
    "world/concepts/sweets.md",
    "---\ncommunity: trinity\naliases: [Sweets Club]\n---\n# Sweets Club\n\nDesserts.\n\n## Secret stash\n\nKnown by: natsu\n\nThe hidden macaron tin.\n",
  );
  write(
    "world/concepts/prefects.md",
    "---\nsummary: Gehenna's feared discipline body.\ncommunity: gehenna\nrenown: known\n---\n# Prefect Team\n\nArmbands and patrols everywhere.\n\n## Inner workings\n\nBudget fights over ledgers.\n",
  );
  write(
    "world/entities/places/gehenna_cellar.md",
    "---\ncommunity: gehenna\n---\n# Gehenna Cellar\n\nA damp cellar below the hall.\n",
  );
  write(
    "world/entities/characters/kazusa.md",
    "---\nname: Kazusa Kyouyama\nschool: Trinity General School\nclub: Sweets Club\n---\n# Kazusa\n\nAloof.\n",
  );
  write(
    "world/entities/characters/natsu.md",
    "---\nname: Natsu Yutori\nschool: Trinity General School\nclub: Sweets Club\n---\n# Natsu\n\nMilk cartons.\n",
  );
  write(
    "world/entities/characters/mine.md",
    "---\nname: Mine Aomori\nschool: Trinity General School\n---\n# Mine\n\nA Sister.\n",
  );
  write(
    "agents/kazusa/wiki/entities/characters/natsu.md",
    "---\nname: Natsu Yutori\nrelation: close friend\n---\nPhilosophical troublemaker.\n\n## What they think of me\n\nEnjoys needling me. (think so)\n\n## Open threads\n\n- Stop her saying Cath Palug.\n\n## Notes\n\n- 2026-10-24 · told by natsu · suspect — Angel 24 might drop strawberry milk.\n- 2026-10-01 · seen it · sure — Old note.\n- 2026-09-01 · seen it · sure — Older note.\n",
  );
  write(
    "agents/kazusa/wiki/concepts/past_and_present.md",
    "---\ntitle: Past and present\n---\nI used to be Cath Palug. I never want that back.\n",
  );
  index = new MemoryIndex({
    worldDir: path.join(root, "world"),
    workspaceDir: (agentId) => path.join(root, "agents", agentId),
    worldRefreshMs: 0,
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("retrieve", () => {
  it("recognizes a name, and by first name alone", () => {
    expect(ids("have you seen Natsu?")[0]).toBe("natsu");
  });

  it("seeds lead, even when the text names nobody", () => {
    expect(ids("hi", ["natsu"])[0]).toBe("natsu");
  });

  it("strips the player prefix from ids", () => {
    write(
      "agents/kazusa/wiki/entities/characters/sensei.md",
      "---\npeer_id: user:sensei\nname: Sensei\n---\nGuides us.\n",
    );
    expect(ids("hi", ["user:sensei"])[0]).toBe("sensei");
  });

  it("finds a personal page by what it says, not only its name", () => {
    expect(ids("who is Cath Palug?")).toContain("past_and_present");
  });

  it("never brings up what they couldn't know", () => {
    expect(ids("what's in the Gehenna Cellar?")).not.toContain(
      "gehenna_cellar",
    );
    expect(ids("damp cellar below")).not.toContain("gehenna_cellar");
  });

  it("does not read insider or `Known by:` text for outsiders", () => {
    expect(ids("budget fights over ledgers")).not.toContain("prefects");
    expect(ids("hidden macaron tin")).not.toContain("sweets");
    expect(ids("hidden macaron tin", [], "natsu")).toContain("sweets");
  });

  it("never brings up their own card or another character's wiki", () => {
    expect(ids("Kazusa Kyouyama")).not.toContain("kazusa");
    expect(ids("Philosophical troublemaker", [], "natsu")).not.toContain(
      "past_and_present",
    );
  });

  it("does not take a common word for a name", () => {
    expect(ids("that one is mine.")).not.toContain("mine");
    expect(ids("Mine is the blue one.")).not.toContain("mine");
    expect(ids("I saw Mine at the chapel.")).toContain("mine");
  });

  it("searches what was said, not the delivery's envelope", () => {
    const delivered =
      "Incoming chats:\n- [Kivotos `kivotos` Fri 2026-10-30 16:00] (chat:direct:kivotos): hello";
    expect(spokenText(delivered).trim()).toBe("hello");
  });

  it("never follows a symlink out of a wiki", () => {
    write("outside/secret.md", "# Secret\n\nThe zeppelin hangar.\n");
    mkdirSync(path.join(root, "agents/natsu/wiki"), { recursive: true });
    symlinkSync(
      path.join(root, "outside"),
      path.join(root, "agents/natsu/wiki/linked"),
    );
    symlinkSync(
      path.join(root, "outside/secret.md"),
      path.join(root, "agents/natsu/wiki/secret.md"),
    );
    expect(ids("zeppelin hangar", [], "natsu")).toEqual([]);
  });

  it("sees an edit on the next retrieval, with no restart", () => {
    expect(ids("ramen shop")).toEqual(
      expect.not.arrayContaining(["past_and_present"]),
    );
    write(
      "agents/kazusa/wiki/concepts/past_and_present.md",
      "---\ntitle: Past and present\n---\nThe ramen shop was my hideout.\n",
    );
    utimesSync(
      path.join(root, "agents/kazusa/wiki/concepts/past_and_present.md"),
      new Date(NOW),
      new Date(NOW),
    );
    expect(ids("ramen shop")).toContain("past_and_present");
  });
});

describe("brainRequest", () => {
  const prompt =
    "Incoming chats:\n- [Natsu Yutori `natsu` Fri 2026-10-30 16:00] (chat:direct:natsu): hi\n- [Sensei `user:sensei` Fri 2026-10-30 16:01] (chat:direct:user:sensei): hello";

  it("pins who is speaking, then who is here", () => {
    expect(sendersOf(prompt)).toEqual(["natsu", "user:sensei"]);
    expect(
      brainRequest({ agentId: "kazusa", prompt, here: ["library"], now: NOW })
        .seeds,
    ).toEqual(["natsu", "user:sensei", "library"]);
  });

  it("does not let those owed a reply crowd out who is speaking", () => {
    write(
      "agents/kazusa/wiki/entities/characters/mine.md",
      "---\nname: Mine Aomori\n---\nA Sister.\n",
    );
    const entities = retrieve(
      index,
      brainRequest({
        agentId: "kazusa",
        prompt:
          "Incoming chats:\n- [Natsu `natsu` Fri] (chat:direct:natsu): hi",
        awaiting: ["mine"],
        now: NOW,
      }),
    );
    expect(entities[0].id).toBe("natsu");
    expect(entities.find(({ id }) => id === "mine")?.signals).toEqual([
      "salience",
    ]);
  });
});

describe("vectors", () => {
  it("finds what shares no word, only among what they could know", () => {
    index.world();
    index.personal("kazusa");
    const vectorFor = (text: string): number[] =>
      /cellar/.test(text) ? [1, 0] : /Cath Palug/.test(text) ? [0, 1] : [0, 0];
    index.addVectors(
      index
        .unembedded(["world", "agent:kazusa"], 1_000)
        .map((text) => [text, vectorFor(text)] as const),
    );
    expect(index.unembedded(["world", "agent:kazusa"], 1_000)).toEqual([]);
    const near = (values: number[]) =>
      retrieve(index, {
        agentId: "kazusa",
        stimulus: "xyzzy",
        queryVector: Float32Array.from(values),
        now: NOW,
      }).map(({ id }) => id);
    expect(near([0, 1])).toContain("past_and_present");
    expect(near([1, 0])).not.toContain("gehenna_cellar");
  });
});

describe("render", () => {
  const options = {
    maxTokens: 800,
    estimate: (text: string) => Math.ceil(text.length / 4),
    nameOf: (id: string) => index.world().pages.get(id)?.name,
  };
  const entities = (stimulus: string, seeds: string[] = []) =>
    retrieve(index, { agentId: "kazusa", stimulus, seeds, now: NOW });

  it("shows view, guess, threads and the newest notes", () => {
    const { text } = renderOnYourMind(entities("", ["natsu"]), options);
    expect(text).toContain(
      "Natsu Yutori `natsu` (close friend): Philosophical troublemaker. You think: Enjoys needling me. (think so) Unfinished: Stop her saying Cath Palug.",
    );
    expect(text).toContain(
      "· Oct 24, Natsu Yutori told you: Angel 24 might drop strawberry milk. (suspect)",
    );
    expect(text).toContain("Old note");
    expect(text).not.toContain("Older note");
  });

  it("gives only a line for what they've merely heard of", () => {
    const { text } = renderOnYourMind(entities("the Prefect Team"), options);
    expect(text).toContain(
      "Prefect Team `prefects`: Gehenna's feared discipline body. (you've only heard of it)",
    );
    expect(text).not.toContain("Armbands");
  });

  it("drops whole entities over budget into Also", () => {
    const { text } = renderOnYourMind(entities("", ["natsu"]), {
      ...options,
      maxTokens: 12,
    });
    expect(text).not.toContain("Philosophical");
  });

  it("lists people by recency, addressed by their chat id", () => {
    write(
      "agents/kazusa/wiki/entities/characters/sensei.md",
      "---\npeer_id: user:sensei\nname: Sensei\nrelation: mentor\n---\nGuides us.\n",
    );
    expect(
      renderRoster(index.personal("kazusa").values(), 20, options.nameOf),
    ).toBe(
      "Natsu Yutori `natsu` (close friend) · Sensei `user:sensei` (mentor)",
    );
  });
});

describe("spokenText and the closing reminder", () => {
  it("does not search for the words of the reminder", () => {
    expect(
      spokenText(
        `Incoming chats:\n- [Natsu \`natsu\` Fri] (chat:direct:natsu): hi\n\n${ONLY_WHAT_YOU_KNOW}`,
      ).trim(),
    ).toBe("hi");
  });
});
