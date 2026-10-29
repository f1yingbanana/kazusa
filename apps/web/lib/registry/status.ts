import { ActivitySummaryItem } from "@/components/status/activity-summary";
import { ConnectionStatusItem } from "@/components/status/connection";
import { DataSourcesItem } from "@/components/status/data-sources";
import { PlayerPlaceItem } from "@/components/status/player-place";
import type { StatusItem } from "./types";

/** Later: new-events jump, storyteller ticker, next wakes, cost meter. */
export const STATUS_ITEMS: readonly StatusItem[] = [
  { id: "connection", side: "start", order: 0, requires: [], component: ConnectionStatusItem },
  { id: "data-sources", side: "start", order: 10, requires: [], component: DataSourcesItem },
  { id: "player-place", side: "end", order: -10, requires: ["places", "location"], component: PlayerPlaceItem },
  { id: "activity", side: "end", order: 0, requires: ["status"], component: ActivitySummaryItem },
];
