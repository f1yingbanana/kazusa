import { z } from "zod";
import { requireMaintainer } from "../../../lib/auth/access";
import { setup } from "../../../lib/setup/setup";

const PrepareSchema = z.object({ id: z.string().trim().min(1) });

/** How far the picked world's download has got, for the setup guide's bar. */
export function GET(request: Request): Response {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  return Response.json(setup.downloads());
}

/**
 * Downloads the world the player picked, so the guide can offer its cast. The
 * owner only, like `/setup`.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  const parsed = PrepareSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "Which world?" }, { status: 400 });
  try {
    return Response.json(await setup.prepare(parsed.data.id, request.signal));
  } catch (error) {
    if (request.signal.aborted)
      return Response.json({ cancelled: true }, { status: 409 });
    return Response.json(
      {
        error: `Couldn't download that world: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }
}

/** Cancels any in-progress world download when the player switches worlds. */
export async function DELETE(request: Request): Promise<Response> {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  await setup.cancelDownload();
  return Response.json({ ok: true });
}
