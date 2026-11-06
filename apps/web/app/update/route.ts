import { z } from "zod";
import { requireLocalOwner } from "../../lib/auth/access";
import { runUpdater } from "../../lib/update/run";

/** Stays the same until the frontend restarts. */
const BOOT = String(Date.now());
/** GitHub allows 60 calls an hour without a token, and a check makes up to five. */
const CHECK_TTL_MS = 2 * 60_000;
const StageSchema = z.object({ to: z.enum(["release", "development"]) });

let checked: { at: number; status: Record<string, unknown> } | undefined;
let staging = false;

/**
 * Local only, like `/setup`: it reports and updates the copy this frontend runs
 * from. `?boot=1` answers at once, for a page waiting out the restart.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  if (params.has("boot")) return Response.json({ boot: BOOT });
  if (
    !checked ||
    params.has("fresh") ||
    Date.now() - checked.at > CHECK_TTL_MS
  ) {
    const result = await runUpdater(["check"]);
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 500 });
    checked = { at: Date.now(), status: result.value };
  }
  return Response.json({ ...checked.status, boot: BOOT, staging });
}

/** Downloads the update; `scripts/dev.mjs` applies it as it restarts Kazusa. */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const parsed = StageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Unknown update." }, { status: 400 });
  if (staging)
    return Response.json(
      { error: "An update is already downloading." },
      { status: 409 },
    );
  staging = true;
  try {
    const result = await runUpdater(["stage", parsed.data.to]);
    checked = undefined;
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: 400 });
  } finally {
    staging = false;
  }
}
