import { parseAuthMode } from "@kazusa/client";
import { accessError, resolveViewer } from "../../lib/auth/access";
import {
  checkOwnerToken,
  clearedOwnerCookie,
  ownerCookie,
  ownerSignInEnabled,
} from "../../lib/auth/owner-session";
import { isSameOrigin } from "../../lib/same-origin";

/** The Gateway token is 64 characters; nothing honest sends more than this. */
const MAX_BODY = 1024;

function refused(request: Request): Response | undefined {
  let mode;
  try {
    mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
  } catch {
    return accessError(
      503,
      "Kazusa authentication is not configured correctly.",
    );
  }
  if (mode !== "public" || !ownerSignInEnabled())
    return accessError(404, "This server has no owner sign-in.");
  if (!isSameOrigin(request))
    return accessError(403, "Use the same origin for this request.");
  return undefined;
}

function signedIn(request: Request, setCookie: string): Response {
  // The answer is who this browser is now, as `/kazusa/access` would say.
  const headers = new Headers({ cookie: setCookie.split(";")[0] });
  return Response.json(resolveViewer(headers), {
    headers: { "Set-Cookie": setCookie, "Cache-Control": "no-store" },
  });
}

/** Signs this browser in as the owner, given the Gateway token. */
export async function POST(request: Request): Promise<Response> {
  const denied = refused(request);
  if (denied) return denied;
  const text = await request.text();
  if (text.length > MAX_BODY) return accessError(413, "That's too long.");
  let token: unknown;
  try {
    token = (JSON.parse(text) as { token?: unknown }).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== "string" || !checkOwnerToken(token))
    return accessError(401, "That isn't this server's token.");
  return signedIn(request, ownerCookie(request));
}

/** Signs this browser out. Other signed-in devices stay signed in. */
export function DELETE(request: Request): Response {
  const denied = refused(request);
  if (denied) return denied;
  return signedIn(request, clearedOwnerCookie(request));
}
