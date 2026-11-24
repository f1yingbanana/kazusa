import { z } from "zod";
import { requireMaintainer } from "../../lib/auth/access";
import { runScript } from "../../lib/run-script";

/** Saves and loads stop and start the Gateway, which `scripts/dev.mjs` owns. */
const SUPERVISED = process.env.KAZUSA_SUPERVISED === "1";

const ActionSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save"),
    name: z.string().max(200).optional(),
    // Into the slot kept for before a world update, named for it.
    beforeUpdate: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("load"),
    ref: z.string().startsWith("refs/saves/"),
  }),
  z.object({
    op: z.literal("delete"),
    ref: z.string().startsWith("refs/saves/"),
  }),
]);

/**
 * The game's saves and the save or load under way (`scripts/world.mjs saves`).
 * The owner only, like `/update`: saving and loading change this machine.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  const result = await runScript("world.mjs", ["saves"], 30_000);
  return result.ok
    ? Response.json({ ...result.value, supervised: SUPERVISED })
    : Response.json(
        { error: result.error, supervised: SUPERVISED },
        { status: 500 },
      );
}

/**
 * Saves the game or loads a save: staged for `scripts/dev.mjs`, which stops the
 * Gateway, does it and starts it again; `GET` says how it's going. Deleting a
 * save needs no restart.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Unknown action." }, { status: 400 });
  const action = parsed.data;
  if (action.op !== "delete" && !SUPERVISED)
    return Response.json(
      {
        error:
          "Saving and loading restart the world, which only Kazusa's app or `npm run dev` can do.",
      },
      { status: 409 },
    );
  const result =
    action.op === "save"
      ? await runScript(
          "world.mjs",
          action.beforeUpdate
            ? ["save-before-update"]
            : ["save", ...(action.name?.trim() ? [action.name] : [])],
          30_000,
        )
      : action.op === "load"
        ? await runScript("world.mjs", ["load", action.ref], 30_000)
        : await runScript("world.mjs", ["delete-save", action.ref], 0);
  return result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error }, { status: 409 });
}
