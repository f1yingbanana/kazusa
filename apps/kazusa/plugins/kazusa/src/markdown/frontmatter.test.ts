import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readFrontmatter } from "./frontmatter.ts";

describe("readFrontmatter", () => {
  it("parses valid frontmatter and returns body verbatim", () => {
    const raw = `---
name: Kazusa
role: Sweets Club
aliases:
  - Cath Palug
---
# Student Profile
Loves macarons.`;

    const schema = z.object({
      name: z.string(),
      role: z.string().optional(),
      aliases: z.array(z.string()).default([]),
    });

    const result = readFrontmatter(raw, schema);
    expect(result.data).toEqual({
      name: "Kazusa",
      role: "Sweets Club",
      aliases: ["Cath Palug"],
    });
    expect(result.body).toBe("# Student Profile\nLoves macarons.");
  });

  it("handles missing frontmatter gracefully", () => {
    const raw = "Plain markdown content without frontmatter.";
    const schema = z.object({
      name: z.string().default("Unknown"),
    });

    const result = readFrontmatter(raw, schema);
    expect(result.data).toEqual({ name: "Unknown" });
    expect(result.body).toBe(raw);
  });
});
