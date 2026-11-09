import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_SKILLS,
  skillsFolder,
  stopWatchingSkills,
  watchSkills,
} from "./watch.ts";

describe("skill paths", () => {
  it("knows a character's skills from the rest of their workspace", () => {
    expect(CHARACTER_SKILLS.test("airi/skills")).toBe(true);
    expect(CHARACTER_SKILLS.test("airi/skills/violin/SKILL.md")).toBe(true);
    expect(CHARACTER_SKILLS.test("airi\\skills\\violin")).toBe(true);
    expect(CHARACTER_SKILLS.test("airi/.agents/skills/violin/SKILL.md")).toBe(
      true,
    );
    expect(CHARACTER_SKILLS.test("airi/.agents/notes.md")).toBe(false);
    expect(CHARACTER_SKILLS.test("airi/wiki/skills/x.md")).toBe(false);
    expect(CHARACTER_SKILLS.test("airi/memory/2026-11-10.md")).toBe(false);
    expect(CHARACTER_SKILLS.test("airi/skillset/SKILL.md")).toBe(false);
  });

  it("watches a skills folder from the folder it is in", () => {
    const { dir, skills } = skillsFolder(
      path.join("world", "shared", "skills"),
    );
    expect(dir).toBe(path.join("world", "shared"));
    expect(skills.test("skills")).toBe(true);
    expect(skills.test("skills/fishing/SKILL.md")).toBe(true);
    expect(skills.test("skills\\fishing")).toBe(true);
    expect(skills.test("skillset/x.md")).toBe(false);
    expect(skills.test("wiki/entities/places/home.md")).toBe(false);
    expect(skillsFolder("a/my.skills").skills.test("myxskills/x")).toBe(false);
  });
});

describe("watchSkills", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "kazusa-skills-watch-")),
    );
    await fs.mkdir(path.join(root, "airi", "wiki"), { recursive: true });
  });

  afterEach(async () => {
    stopWatchingSkills();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reloads once a skill lands in a character's workspace, not for a wiki edit", async () => {
    const changed = vi.fn();
    const warn = vi.fn();
    watchSkills([{ dir: root, skills: CHARACTER_SKILLS }], changed, warn, 50);
    // Let the native watcher start before writing.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await fs.writeFile(path.join(root, "airi", "wiki", "home.md"), "Home.");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(changed).not.toHaveBeenCalled();

    const skill = path.join(root, "airi", "skills", "violin");
    await fs.mkdir(skill, { recursive: true });
    await fs.writeFile(path.join(skill, "SKILL.md"), "---\nname: violin\n---");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps one watcher per process and calls the newest handler", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const roots = [{ dir: root, skills: CHARACTER_SKILLS }];
    watchSkills(roots, first, vi.fn(), 50);
    watchSkills(roots, second, vi.fn(), 50);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const skill = path.join(root, "airi", "skills", "violin");
    await fs.mkdir(skill, { recursive: true });
    await fs.writeFile(path.join(skill, "SKILL.md"), "---\nname: violin\n---");
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(first).not.toHaveBeenCalled();
  });
});
