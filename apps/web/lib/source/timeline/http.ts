import {
  TimelineResponseSchema,
  type TimelineQuery,
  type TimelineResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

/**
 * `GET /kazusa/timeline` per the proposed contract. Not reachable until the
 * plugin journal lands and `timeline` is added to the proxy allowlist; the
 * capability resolver keeps this domain on mock until then.
 */
export async function fetchTimeline(
  baseUrl: string,
  query: TimelineQuery,
  token?: string,
): Promise<TimelineResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/timeline", {
      before: query.before,
      after: query.after,
      limit: query.limit,
      actors: query.actors?.join(","),
      kinds: query.kinds?.join(","),
      chats: query.chats?.join(","),
    }),
    undefined,
    token,
  );
  return TimelineResponseSchema.parse(data);
}
