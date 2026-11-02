/**
 * Whether a browser sent this from our own pages. Compares against `Host`,
 * since a production `request.url` says `localhost` even when the page is on
 * 127.0.0.1. Only browsers send `Origin`; anything else has no cross-site page
 * behind it.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
