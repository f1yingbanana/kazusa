import { parseAuthMode } from "@kazusa/client";

/**
 * Whether a browser sent this from our own pages. In local/public mode,
 * compares strictly against `Host`. In trusted-proxy mode, also accepts a
 * matching configured `KAZUSA_PUBLIC_ORIGIN`. Only browsers send `Origin`;
 * anything else has no cross-site page behind it.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    let mode;
    try {
      mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
    } catch {
      return false;
    }
    if (mode === "trusted-proxy") {
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
    }
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return originUrl.host === host;
  } catch {
    return false;
  }
}
