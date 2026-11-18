import { WorldValues } from "@/components/stats/world-values";
import type { TopBarItem } from "./types";

/** What the top bar shows of the world beside its clock. */
export const TOP_BAR_ITEMS: readonly TopBarItem[] = [
  {
    id: "world-values",
    order: 0,
    requires: ["stats"],
    component: WorldValues,
  },
];
