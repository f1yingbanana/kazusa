import { z } from "zod";
import { requireLocalOwner } from "../../lib/auth/access";
import {
  GatewayConfigError,
  readGatewayConnection,
  saveGatewayConnection,
} from "../../lib/connection/gateway-config";
import { resetWorldChanges } from "../../lib/proxy/world-changes";

const UpdateConnectionSchema = z.object({
  url: z.string().optional(),
  token: z.string().optional(),
  reset: z.boolean().optional(),
});

/**
 * Local-owner only: inspects the server's active Gateway URL without leaking
 * its token.
 */
export function GET(request: Request): Response {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  return Response.json(readGatewayConnection(), {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Local-owner only: updates `KAZUSA_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`
 * in `.env.local` and applies them immediately to the running proxy.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireLocalOwner(request);
  if (denied) return denied;
  const parsed = UpdateConnectionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "That connection request is not valid." },
      { status: 400 },
    );
  }
  try {
    const info = saveGatewayConnection(parsed.data);
    resetWorldChanges();
    return Response.json(
      { ok: true, ...info },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GatewayConfigError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't save the Gateway connection.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
