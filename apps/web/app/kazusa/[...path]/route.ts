/** Local single-player bridge; the Gateway credential never enters browser code. */
const ROUTES = new Map([
  ["world", "GET"],
  ["clock", "POST"],
  ["characters", "GET"],
  ["character", "GET"],
  ["agents", "GET"],
  ["chats", "GET"],
  ["messages", "GET"],
  ["events", "GET"],
  ["send", "POST"],
  ["chats/manage", "POST"],
  ["typing", "POST"],
  ["timeline", "GET"],
]);

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context): Promise<Response> {
  const route = (await context.params).path.join("/");
  const method = ROUTES.get(route);
  if (!method)
    return Response.json({ error: "Unknown Kazusa route." }, { status: 404 });
  if (request.method !== method)
    return new Response(null, { status: 405, headers: { Allow: method } });
  const origin = request.headers.get("origin");
  if (
    request.method === "POST" &&
    origin &&
    origin !== new URL(request.url).origin
  ) {
    return Response.json(
      { error: "Use the same origin for chat requests." },
      { status: 403 },
    );
  }
  const base = process.env.KAZUSA_GATEWAY_URL ?? "http://127.0.0.1:18789";
  const target = new URL(`/kazusa/${route}`, base);
  target.search = new URL(request.url).search;
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const response = await fetch(target, {
      method,
      headers,
      cache: "no-store",
      signal: request.signal,
      body: method === "POST" ? await request.text() : undefined,
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      { error: "Could not reach the Kazusa Gateway." },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
