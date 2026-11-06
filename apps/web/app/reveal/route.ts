import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { requireLocalOwner } from "../../lib/auth/access";
import { revealCommand } from "../../lib/setup/reveal";
import { setup } from "../../lib/setup/setup";

const RevealSchema = z.object({ file: z.enum(["config", "env"]) });

/** Local only, like `/setup`. Only these two named files can ever be shown. */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const parsed = RevealSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ error: "Unknown file." }, { status: 400 });
  const file = setup.files[parsed.data.file];
  if (!existsSync(file))
    return Response.json(
      { error: "That file doesn't exist yet." },
      { status: 404 },
    );
  const [command, args] = revealCommand(process.platform, file);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  // Nothing useful comes back: Explorer exits with 1 even when it worked.
  child.on("error", () => undefined);
  child.unref();
  return Response.json({ path: file });
}
