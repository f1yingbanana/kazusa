import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const TEXT = /\.(md|json|txt)$/;

/** World-relative paths of the files a world update covers. */
async function filesOf(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = path.join(relative, entry.name);
      if (entry.name === ".DS_Store" || entry.name.endsWith(".tmp")) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.push(child.split(path.sep).join("/"));
    }
  };
  for (const part of ["shared", "workspaces"])
    if (existsSync(path.join(root, part))) await walk(part);
  if (existsSync(path.join(root, "world.json"))) out.push("world.json");
  return out.sort();
}

/**
 * Records the template as imported, in `<live>/.template/`: text files verbatim
 * and a hash of every file in `manifest.json`. A later world update (the
 * plugin's `world_update`, `src/world-update/update.ts`) compares against it to
 * tell what the creator changed from what play changed.
 */
export async function writeTemplateSnapshot(
  live: string,
  template: string,
  id: string,
): Promise<void> {
  const dir = path.join(live, ".template");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {};
  for (const file of await filesOf(template)) {
    const data = await readFile(path.join(template, file));
    files[file] = createHash("sha256").update(data).digest("hex");
    if (TEXT.test(file)) {
      const target = path.join(dir, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    }
  }
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify({ template: id, files })}\n`,
  );
}
