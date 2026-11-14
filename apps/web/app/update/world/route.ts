import { requireLocalOwner } from "../../../lib/auth/access";
import {
  runScript,
  tracking,
  type ScriptResult,
  type WorldDownload,
} from "../../../lib/run-script";

/** A check is one `ls-remote`, and GitHub for a size: a second or two. */
const CHECK_TTL_MS = 2 * 60_000;

let checked: { at: number; result: ScriptResult } | undefined;
let checking: Promise<ScriptResult> | undefined;
/** The download the player asked for, how far it has got, how it ended. */
let downloading: Promise<void> | undefined;
let progress: WorldDownload | undefined;
let downloaded: { at: number; error?: string } | undefined;

function state() {
  return {
    downloading: Boolean(downloading),
    ...(progress ? { progress } : {}),
    ...(downloaded ? { lastDownload: downloaded } : {}),
  };
}

/**
 * Whether the creator released something newer than the world stands on
 * (`scripts/world.mjs check`), nothing downloaded, and how a download is going.
 * Local only, like `/update`: only someone who may change this machine is
 * asked. `?fresh=1` checks again at once.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.has("fresh");
  if (!checked || fresh || Date.now() - checked.at > CHECK_TTL_MS) {
    checking ??= runScript("world.mjs", ["check"], 60_000).finally(() => {
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
 * Downloads the newest release (`git fetch` of its tag), once the player has
 * said so: it can be a gigabyte. Answers at once; `GET` says how it's going,
 * from git's own progress, and how it ended.
 */
export function POST(request: Request): Response {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  if (downloading)
    return Response.json(
      { error: "This world's new version is downloading already." },
      { status: 409 },
    );
  downloading = runScript(
    "world.mjs",
    ["download"],
    0,
    tracking((value) => {
      progress = value;
    }),
  ).then((result) => {
    downloaded = result.ok
      ? { at: Date.now() }
      : { at: Date.now(), error: result.error };
    // What's downloaded changed: the next check says so.
    checked = undefined;
    progress = undefined;
    downloading = undefined;
  });
  return Response.json({ started: true }, { status: 202 });
}
