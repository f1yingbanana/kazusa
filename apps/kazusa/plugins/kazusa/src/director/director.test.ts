import { describe, expect, it } from "vitest";
import { MAX_WATCHED, promisedIn, watchingIn } from "./director.ts";

describe("the notebook's watch list", () => {
  it("reads who and what for, ids alone too, at most four", () => {
    const notebook = [
      "---",
      "watching:",
      "  - who: serina",
      "    for: her tea with the player",
      "  - hanae",
      "  - who: serina",
      "  - who: a",
      "  - who: b",
      "  - who: c",
      "---",
      "# My memory",
    ].join("\n");
    expect(watchingIn(notebook)).toEqual([
      { who: "serina", for: "her tea with the player" },
      { who: "hanae" },
      { who: "a" },
      { who: "b" },
    ]);
    expect(watchingIn(notebook)).toHaveLength(MAX_WATCHED);
  });

  it("still reads a watch list whose YAML breaks on an unquoted colon", () => {
    const notebook = [
      "---",
      "watching:",
      "  - who: serina",
      "    for: 08:20 LOOK — at the ward. Watch: whether she asks him; until 21:00",
      "  - who: hanae",
      "    for: Watch: the rota",
      "      and the tea",
      "---",
      "# My memory",
    ].join("\n");
    expect(watchingIn(notebook)).toEqual([
      {
        who: "serina",
        for: "08:20 LOOK — at the ward. Watch: whether she asks him; until 21:00",
      },
      { who: "hanae", for: "Watch: the rota and the tea" },
    ]);
  });

  it("watches nobody without front matter, or with a broken one", () => {
    expect(watchingIn("# My memory\n\nwatching: x")).toEqual([]);
    expect(watchingIn("---\nwatching: [\n---\n")).toEqual([]);
    expect(watchingIn("---\nother: x\n---\n")).toEqual([]);
    expect(watchingIn("---\nwatching: serina\n---\n")).toEqual([]);
  });
});

describe("promised beats", () => {
  it("reads them from front matter, line by line when YAML breaks", () => {
    expect(
      promisedIn("---\npromised:\n  - They argue\n  - They make up\n---\n"),
    ).toEqual(["They argue", "They make up"]);
    expect(
      promisedIn(
        "---\nwatching:\n  - who: a\n    for: Watch: x\npromised:\n  - Beat one: loud\n    and long\n---\n",
      ),
    ).toEqual(["Beat one: loud and long"]);
    expect(promisedIn("# none")).toEqual([]);
  });
});

describe("the settings block", () => {
  it("is found wherever the director left it", () => {
    const notebook = [
      "# Memory",
      "",
      "## Goals",
      "",
      "---",
      "watching:",
      "  - who: ann",
      "promised:",
      "  - They argue",
      "---",
      "",
      "## Arcs",
    ].join("\n");
    expect(watchingIn(notebook)).toEqual([{ who: "ann" }]);
    expect(promisedIn(notebook)).toEqual(["They argue"]);
  });
});
