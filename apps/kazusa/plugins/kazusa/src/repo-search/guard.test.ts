import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refusal } from "./guard.ts";

let outer: string;
let repo: string;
let world: string;

beforeEach(() => {
  outer = mkdtempSync(path.join(tmpdir(), "repo-guard-"));
  repo = path.join(outer, "kazusa");
  world = path.join(repo, "apps/kazusa/world");
  mkdirSync(path.join(world, "workspaces/arona"), { recursive: true });
  writeFileSync(path.join(outer, "secret.txt"), "outside");
  symlinkSync(outer, path.join(world, "workspaces/arona/escape"));
});
afterEach(() => rmSync(outer, { recursive: true, force: true }));

describe("refusal", () => {
  it("lets file tools work anywhere in the repository", () => {
    expect(
      refusal("read", { path: "shared/wiki/INDEX.md" }, world, repo),
    ).toBeUndefined();
    expect(
      refusal("read", { path: "../worlds/demo/world.json" }, world, repo),
    ).toBeUndefined();
    expect(refusal("ls", {}, world, repo)).toBeUndefined();
    expect(
      refusal(
        "write",
        { path: "../../../README.md", content: "" },
        world,
        repo,
      ),
    ).toBeUndefined();
  });

  it("refuses paths outside it, however they are written", () => {
    for (const p of [
      "../../../../secret.txt",
      path.join(outer, "secret.txt"),
      "~/.ssh/id_rsa",
      "workspaces/arona/escape/secret.txt",
    ])
      expect(refusal("read", { path: p }, world, repo)?.result).toBe(
        "outside-repository",
      );
  });

  it("refuses secrets inside it", () => {
    expect(refusal("read", { path: ".state/.env" }, world, repo)?.result).toBe(
      "secret-file",
    );
  });

  it("checks every file a patch touches", () => {
    const input =
      "*** Begin Patch\n*** Add File: shared/a.md\n+x\n*** Update File: ../../../../secret.txt\n*** End Patch";
    expect(refusal("apply_patch", { input }, world, repo)?.result).toBe(
      "outside-repository",
    );
  });

  it("leaves other tools and web images alone", () => {
    expect(
      refusal("send_message", { path: "/etc/passwd" }, world, repo),
    ).toBeUndefined();
    expect(
      refusal("view_image", { path: "https://example.com/a.png" }, world, repo),
    ).toBeUndefined();
  });
});
