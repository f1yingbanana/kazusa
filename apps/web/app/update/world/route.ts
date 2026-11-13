import { requireLocalOwner } from "../../../lib/auth/access";
import { runScript, type ScriptResult } from "../../../lib/run-script";

/** A check lists tags and peeks at file lists: a second or two, nothing big. */
const CHECK_TTL_MS = 2 * 60_000;

let checked: { at: number; result: ScriptResult } | undefined;
let checking: Promise<ScriptResult> | undefined;
/** The download the player asked for, and how the last one ended. */
let downloading: Promise<void> | undefined;
let downloaded: { at: number; error?: string; lines?: unknown } | undefined;

function state() {
  return {
    downloading: Boolean(downloading),
    ...(downloaded ? { lastDownload: downloaded } : {}),
  };
}

/**
 * Whether the world in play has a newer release, what it changes and how big it
 * is (`scripts/world-repo.mjs check`), downloading nothing. Local only, like
 * `/update`: only someone who may change this machine is asked. `?fresh=1`
 * checks again at once.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.has("fresh");
  if (!checked || fresh || Date.now() - checked.at > CHECK_TTL_MS) {
    checking ??= runScript("world-repo.mjs", ["check"], 60_000).finally(() => {
      checking = undefined;
    });
    checked = { at: Date.now(), result: await checking };
  }
  const { at, result } = checked;
  return result.ok
    ? Response.json({ ...result.value, at, ...state() })
    : Response.json({ error: result.error, at, ...state() }, { status: 500 });
}

/**
 * Downloads the newest release into the template's clone, once the player has
 * said so: it can be a gigabyte. Answers at once; the download's progress is
 * `GET /setup/world`'s, and how it ended is the next `GET`'s.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  if (downloading)
    return Response.json(
      { error: "This world's new version is downloading already." },
      { status: 409 },
    );
  downloading = runScript("world-repo.mjs", ["download"], 0).then((result) => {
    downloaded = result.ok
      ? { at: Date.now(), lines: result.value.lines }
      : { at: Date.now(), error: result.error };
    // What's downloaded changed: the next check says so.
    checked = undefined;
    downloading = undefined;
  });
  return Response.json({ started: true }, { status: 202 });
}
