import { SaveActionSchema } from "@kazusa/client";
import { requireMaintainer } from "../../lib/auth/access";
import { runScript } from "../../lib/run-script";

/** Saves and loads stop and start the Gateway, which `scripts/dev.mjs` owns. */
const SUPERVISED = process.env.KAZUSA_SUPERVISED === "1";

/** The commands this server has run on the saves, in order. */
let queue: Promise<unknown> = Promise.resolve();

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
  const parsed = SaveActionSchema.safeParse(
    await request.json().catch(() => null),
  );
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
  const args =
    action.op === "save"
      ? action.beforeUpdate
        ? ["save-before-update"]
        : ["save", ...(action.name?.trim() ? [action.name] : [])]
      : action.op === "load"
        ? ["load", action.ref]
        : ["delete-save", action.ref];
  // One at a time: two tabs asking at once can't both pass "nothing running".
  const run = queue.then(() =>
    runScript("world.mjs", args, action.op === "delete" ? 0 : 30_000),
  );
  queue = run;
  const result = await run;
  return result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error }, { status: 409 });
}
