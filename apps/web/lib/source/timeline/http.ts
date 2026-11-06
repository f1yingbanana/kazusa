import {
  TimelineResponseSchema,
  type TimelineQuery,
  type TimelineResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

/** `GET /kazusa/timeline`. */
export async function fetchTimeline(
  query: TimelineQuery,
): Promise<TimelineResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/timeline", {
      before: query.before,
      after: query.after,
      limit: query.limit,
      actors: query.actors?.join(","),
      kinds: query.kinds?.join(","),
      chats: query.chats?.join(","),
    }),
  );
  return TimelineResponseSchema.parse(data);
}
