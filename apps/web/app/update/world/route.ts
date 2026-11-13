import { requireLocalOwner } from "../../../lib/auth/access";
import { runScript, type ScriptResult } from "../../../lib/run-script";

/** A check is a `git fetch`: cheap when nothing is new, so hourly is fine. */
const CHECK_TTL_MS = 2 * 60_000;
/**
 * How long a request waits on its check. A new release is a long download,
 * which the progress bar follows (`GET /setup/world`), so past this the answer
 * is that it's still checking.
 */
const ANSWER_WITHIN_MS = 10_000;

let checked: { at: number; result: ScriptResult } | undefined;
let running: Promise<ScriptResult> | undefined;

function answer({ at, result }: { at: number; result: ScriptResult }) {
  return result.ok
    ? Response.json({ ...result.value, at })
    : Response.json({ error: result.error, at }, { status: 500 });
}

/**
 * Fetches a new version of the live world's template while Kazusa runs, as
 * starting does (`scripts/world-repo.mjs check`). Local only, like `/update`:
 * the download lands on this machine. `?fresh=1` checks again at once.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.has("fresh");
  if (checked && !fresh && Date.now() - checked.at < CHECK_TTL_MS)
    return answer(checked);
  running ??= runScript("world-repo.mjs", ["check"], 0).then((result) => {
    checked = { at: Date.now(), result };
    running = undefined;
    return result;
  });
  const done = await Promise.race([
    running.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), ANSWER_WITHIN_MS),
    ),
  ]);
  return done && checked
    ? answer(checked)
    : Response.json({ checking: true, at: Date.now() });
}
