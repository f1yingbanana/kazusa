import { requireLocalOwner } from "../../../lib/auth/access";
import { setup } from "../../../lib/setup/setup";

/**
 * Sets aside a world an older Kazusa made, so setup can start a new one. Local
 * only, like `/setup`.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  try {
    await setup.startOver();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
}
