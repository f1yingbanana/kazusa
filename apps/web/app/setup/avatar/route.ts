import { createReadStream } from "node:fs";
import { requireMaintainer } from "../../../lib/auth/access";
import { setup } from "../../../lib/setup/setup";

/** Serves a character's workspace avatar while setting up a world. */
export async function GET(request: Request): Promise<Response> {
  const denied = requireMaintainer(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  const avatar = id ? await setup.avatar(id) : undefined;
  if (!avatar) return new Response(null, { status: 404 });
  const stream = createReadStream(avatar.file);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) =>
        controller.enqueue(
          typeof chunk === "string" ? Buffer.from(chunk) : chunk,
        ),
      );
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": avatar.contentType,
      "Content-Length": String(avatar.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
