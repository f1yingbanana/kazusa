import { z } from "zod";
import { isSameOrigin } from "@/lib/same-origin";
import { setup } from "@/lib/setup/setup";

const PrepareSchema = z.object({ id: z.string().trim().min(1) });

/**
 * Downloads the world the player picked, so the guide can offer its cast. Local
 * only, like `/setup`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Use the same origin for setup requests." },
      { status: 403 },
    );
  const parsed = PrepareSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "Which world?" }, { status: 400 });
  try {
    return Response.json(await setup.prepare(parsed.data.id));
  } catch (error) {
    return Response.json(
      {
        error: `Couldn't download that world: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }
}
