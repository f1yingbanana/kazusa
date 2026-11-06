import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adoptWorldPackage, templateOf } from "./world-package.mjs";

const put = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};

/** A repo with two templates and a live world whose player is `player`. */
function repo(player) {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-package-"));
  const app = path.join(root, "apps/kazusa");
  for (const [id, user] of [
    ["kivotos", "user:sensei"],
    ["lands", "user:tarnished"],
  ])
    put(path.join(app, "worlds", id, "package.json"), {
      name: id,
      version: "0.3.0",
      kazusa: { systemAgent: "admin", config: { user: { id: user } } },
    });
  put(path.join(app, "world/openclaw.json"), {
    plugins: { entries: { kazusa: { config: { user: { id: player } } } } },
  });
  return { root, live: path.join(app, "world") };
}
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

describe("adoptWorldPackage", () => {
  it("takes the template world.json named and retires world.json", () => {
    const { root, live } = repo("user:someone-else");
    put(path.join(live, "world.json"), { id: "lands", title: "Lands" });
    expect(adoptWorldPackage(root)).toHaveLength(1);
    expect(read(path.join(live, "package.json"))).toMatchObject({
      name: "lands",
      version: "0.3.0",
      kazusa: { template: "lands", systemAgent: "admin" },
    });
    expect(existsSync(path.join(live, "world.json"))).toBe(false);
  });

  it("adopts a world imported but not yet set up", () => {
    const { root, live } = repo("user:sensei");
    rmSync(path.join(live, "openclaw.json"));
    put(path.join(live, "world.json"), { id: "lands" });
    adoptWorldPackage(root);
    expect(read(path.join(live, "package.json")).kazusa.template).toBe("lands");
  });

  it("tells the template by the player's id when nothing names it", () => {
    const { root, live } = repo("user:sensei");
    expect(templateOf(root)).toBe("kivotos");
    adoptWorldPackage(root);
    expect(read(path.join(live, "package.json")).kazusa.template).toBe(
      "kivotos",
    );
  });

  it("replaces a package.json that doesn't say which template it is", () => {
    const { root, live } = repo("user:sensei");
    put(path.join(live, "package.json"), { name: "by-hand" });
    adoptWorldPackage(root);
    expect(read(path.join(live, "package.json")).name).toBe("kivotos");
  });

  it("leaves an adopted world, and one it can't place, alone", () => {
    const adopted = repo("user:sensei");
    const mine = { name: "mine", kazusa: { template: "kivotos" } };
    put(path.join(adopted.live, "package.json"), mine);
    expect(adoptWorldPackage(adopted.root)).toEqual([]);
    expect(read(path.join(adopted.live, "package.json"))).toEqual(mine);

    const unknown = repo("user:nobody");
    expect(adoptWorldPackage(unknown.root)).toEqual([]);
    expect(existsSync(path.join(unknown.live, "package.json"))).toBe(false);
  });
});
