import {
  TimelineResponseSchema,
  type TimelineQuery,
  type TimelineResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

/** `GET /kazusa/timeline`. */
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
