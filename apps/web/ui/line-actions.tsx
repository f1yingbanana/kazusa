"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import { Toolbar, ToolbarIconButton } from "./toolbar";

export interface LineAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

/**
 * What can be done with one line of a conversation, beside it while the pointer
 * is over its line or one of them has focus. Touch screens hold the line
 * instead, for the same actions in a sheet (`ContextMenu`).
 */
export function LineActions({ actions }: { actions: readonly LineAction[] }) {
  return (
    <div
      className={cx(
        "shrink-0 scale-90 opacity-0 transition-[opacity,scale] duration-150 ease-out pointer-coarse:hidden",
        "pointer-events-none group-hover/line:pointer-events-auto group-hover/line:scale-100 group-hover/line:opacity-100 has-focus-visible:pointer-events-auto has-focus-visible:scale-100 has-focus-visible:opacity-100",
      )}
    >
      <Toolbar label="Message actions" className="p-0.5 shadow-none">
        {actions.map((action) => (
          <ToolbarIconButton
            key={action.label}
            label={action.label}
            className="size-7 [&_svg]:size-3.5"
            onClick={action.run}
          >
            {action.icon}
          </ToolbarIconButton>
        ))}
      </Toolbar>
    </div>
  );
}
