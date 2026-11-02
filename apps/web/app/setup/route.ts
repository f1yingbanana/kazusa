import { isSameOrigin } from "@/lib/same-origin";
import { setup, SetupRequestSchema } from "@/lib/setup/setup";

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
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Use the same origin for setup requests." },
      { status: 403 },
    );
  const parsed = SetupRequestSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: "That setup request is not valid." },
      { status: 400 },
    );
  if (
    parsed.data.openrouterKey &&
    (await keyWorks(parsed.data.openrouterKey)) === false
  )
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
