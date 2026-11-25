"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Toolbar, ToolbarIconButton } from "./toolbar";

export interface LineAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

/**
 * What can be done with one line of a conversation, beside it: shown while the
 * pointer is over its line or one of them has focus, or after a long press on
 * touch (`open`), when a tap anywhere else puts it away.
 */
export function LineActions({
  actions,
  open,
  onClose,
}: {
  actions: readonly LineAction[];
  open: boolean;
  onClose: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onClose]);

  return (
    <div
      ref={bar}
      data-open={open || undefined}
      className={cx(
        "shrink-0 scale-90 opacity-0 transition-[opacity,scale] duration-150 ease-out",
        "pointer-events-none group-hover/line:pointer-events-auto group-hover/line:scale-100 group-hover/line:opacity-100 has-focus-visible:pointer-events-auto has-focus-visible:scale-100 has-focus-visible:opacity-100",
        "data-[open]:pointer-events-auto data-[open]:scale-100 data-[open]:opacity-100",
      )}
    >
      <Toolbar label="Message actions" className="p-0.5 shadow-none">
        {actions.map((action) => (
          <ToolbarIconButton
            key={action.label}
            label={action.label}
            className="size-7 [&_svg]:size-3.5"
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.icon}
          </ToolbarIconButton>
        ))}
      </Toolbar>
    </div>
  );
}
