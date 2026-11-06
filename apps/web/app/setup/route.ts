import { requireLocalOwner } from "../../lib/auth/access";
import { setup, SetupRequestSchema } from "../../lib/setup/setup";

/** Costs nothing. Undefined means OpenRouter couldn't be reached to say. */
async function keyWorks(key: string): Promise<boolean | undefined> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return undefined;
  }
}

/** Local only: `scripts/dev.mjs` binds the frontend to loopback. */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const parsed = SetupRequestSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: "That setup request is not valid." },
      { status: 400 },
    );
  // OpenRP has no free way to check a key: its model list answers anyone.
  const { key } = parsed.data;
  if (key?.provider === "openrouter" && (await keyWorks(key.value)) === false)
    return Response.json(
      {
        field: "key",
        error: "OpenRouter rejected that key. Check it and try again.",
      },
      { status: 400 },
    );
  await setup.apply(parsed.data);
  return Response.json({ ok: true });
}
