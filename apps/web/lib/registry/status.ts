import { ActivitySummaryItem } from "@/components/status/activity-summary";
import { ConnectionStatusItem } from "@/components/status/connection";
import { DataSourcesItem } from "@/components/status/data-sources";
import { FailuresItem } from "@/components/status/failures";
import { PlayerPlaceItem } from "@/components/status/player-place";
import { ReadOnlyStatusItem } from "@/components/status/read-only";
import { UpdateAvailableItem } from "@/components/status/update-available";
import type { StatusItem } from "./types";

/** Later: new-events jump, storyteller ticker, next wakes, cost meter. */
export const STATUS_ITEMS: readonly StatusItem[] = [
  {
    id: "connection",
    side: "start",
    order: 0,
    requires: [],
    component: ConnectionStatusItem,
  },
  {
    id: "read-only",
    side: "start",
    order: 5,
    requires: [],
    component: ReadOnlyStatusItem,
  },
  {
    id: "data-sources",
    side: "start",
    order: 10,
    requires: [],
    component: DataSourcesItem,
  },
  {
    id: "update",
    side: "end",
    order: -30,
    requires: [],
    requiresPermission: "manage",
    component: UpdateAvailableItem,
  },
  {
    id: "failures",
    side: "end",
    order: -20,
    requires: ["status"],
    component: FailuresItem,
  },
  {
    id: "player-place",
    side: "end",
    order: -10,
    requires: ["places", "location"],
    component: PlayerPlaceItem,
  },
  {
    id: "activity",
    side: "end",
    order: 0,
    requires: ["status"],
    component: ActivitySummaryItem,
  },
];
