import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Owner sign-in for a public frontend (`npm run public`), such as one a
 * Cloudflare tunnel puts on the internet. Everyone reads as a visitor; whoever
 * pastes the Gateway token gets a cookie that makes them the owner.
 *
 * The cookie never holds the token: it is the time it was issued, signed with
 * the token. A new token signs everyone out; so does `MAX_AGE_S` running out.
 */
export const OWNER_COOKIE = "kazusa_owner";
export const MAX_AGE_S = 30 * 24 * 60 * 60;

function key(): string | undefined {
  if (process.env.KAZUSA_OWNER_SIGN_IN !== "1") return undefined;
  return process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined;
}

export function ownerSignInEnabled(): boolean {
  return key() !== undefined;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(secret: string, issued: string): string {
  return createHmac("sha256", secret)
    .update(`kazusa-owner:${issued}`)
    .digest("base64url");
}

export function checkOwnerToken(token: string): boolean {
  const secret = key();
  return secret !== undefined && same(token.trim(), secret);
}

/** Behind a tunnel the hop to Next is plain HTTP; the browser's isn't. */
function secure(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

function cookie(request: Request, value: string, maxAge: number): string {
  return [
    `${OWNER_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(secure(request) ? ["Secure"] : []),
  ].join("; ");
}

export function ownerCookie(request: Request, now = Date.now()): string {
  const secret = key();
  if (!secret) throw new Error("Owner sign-in is off.");
  const issued = String(Math.floor(now / 1000));
  return cookie(request, `${issued}.${sign(secret, issued)}`, MAX_AGE_S);
}

export function clearedOwnerCookie(request: Request): string {
  return cookie(request, "", 0);
}

/** Whether this `Cookie` header carries one live, correctly signed session. */
export function hasOwnerSession(
  cookieHeader: string | null,
  now = Date.now(),
): boolean {
  const secret = key();
  if (!secret || !cookieHeader) return false;
  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${OWNER_COOKIE}=`))
    .map((part) => part.slice(OWNER_COOKIE.length + 1));
  // Two of them means something set one we didn't; trust neither.
  if (values.length !== 1) return false;
  const match = /^(\d{1,12})\.([\w-]+)$/.exec(values[0]);
  if (!match) return false;
  const [, issued, mac] = match;
  const age = now / 1000 - Number(issued);
  if (age < -60 || age > MAX_AGE_S) return false;
  return same(mac, sign(secret, issued));
}
