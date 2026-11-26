"use client";

import { useAccess } from "@/hooks/use-access";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import { cx } from "@/ui/cx";
import { ActivityItem } from "./status/activity";
import { ConnectionItem } from "./status/connection";
import { FailuresItem } from "./status/failures";
import { ProblemsItem } from "./status/problems";
import { UpdateItem } from "./status/update";
import { YouAreItem } from "./status/you-are";

/** Which signals this viewer gets; shared with the phone's More sheet. */
export function useStatusAccess() {
  const { resolved } = useSources();
  const { hasPermission, canMaintain } = useAccess();
  const statuses = satisfies(resolved, ["status"]);
  return {
    activity: statuses,
    failures: statuses,
    problems: satisfies(resolved, ["wiki"]) && hasPermission("manage"),
    update: hasPermission("manage") && canMaintain,
  };
}

/*
  Items that render nothing collapse, and a divider is drawn only between
  those that show.
*/
const GROUP =
  "flex min-w-0 items-center gap-3 [&>:not(:empty)~:not(:empty)]:before:me-3 [&>:not(:empty)~:not(:empty)]:before:h-3 [&>:not(:empty)~:not(:empty)]:before:w-px [&>:not(:empty)~:not(:empty)]:before:bg-ui-line [&>:not(:empty)~:not(:empty)]:before:content-[''] *:flex *:items-center *:empty:hidden";

/**
 * Small, glanceable signals about the world. Never controls that change the
 * simulation.
 */
export function StatusBar({ className }: { className?: string }) {
  const show = useStatusAccess();
  return (
    <footer
      className={cx(
        "flex h-8 min-w-0 items-center justify-between gap-4 pe-5 text-xs text-ui-soft",
        className,
      )}
    >
      <div className={GROUP}>
        <div>
          <ConnectionItem />
        </div>
      </div>
      <div className={GROUP}>
        <div>{show.update ? <UpdateItem /> : null}</div>
        <div>{show.problems ? <ProblemsItem /> : null}</div>
        <div>{show.failures ? <FailuresItem /> : null}</div>
        <div className="min-w-0">
          <YouAreItem />
        </div>
        <div>{show.activity ? <ActivityItem /> : null}</div>
      </div>
    </footer>
  );
}
