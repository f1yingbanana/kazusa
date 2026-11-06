/**
 * Whether a browser sent this from our own pages. Compares against `Host`,
 * `x-forwarded-host`, or a configured `KAZUSA_PUBLIC_ORIGIN`. Only browsers
 * send `Origin`; anything else has no cross-site page behind it.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const publicOrigin = process.env.KAZUSA_PUBLIC_ORIGIN?.trim();
    if (publicOrigin) {
      const expected = new URL(publicOrigin);
      if (
        originUrl.host === expected.host &&
        originUrl.protocol === expected.protocol
      ) {
        return true;
      }
    }
    const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
    if (forwardedHost && originUrl.host === forwardedHost) {
      return true;
    }
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return originUrl.host === host;
  } catch {
    return false;
  }
}
