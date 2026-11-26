"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { TextButton } from "./button";
import { cx } from "./cx";

const LINES = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
} as const;

/**
 * Text cut to a few lines that opens whole when it was cut and is pressed
 * (links inside still work as links), and closes again the same way. Keyboard
 * users get the same toggle as a button that shows on focus.
 */
export function ClampText({
  lines = 3,
  className,
  children,
}: {
  lines?: keyof typeof LINES;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || open) return;
    const measure = () => setCut(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, children]);

  const toggles = cut || open;
  const onClick = (event: MouseEvent) => {
    if (!toggles) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    setOpen((was) => !was);
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        onClick={onClick}
        data-toggles={toggles || undefined}
        className={cx(
          open ? undefined : LINES[lines],
          "data-toggles:cursor-pointer",
          className,
        )}
      >
        {children}
      </div>
      {toggles ? (
        <TextButton
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="sr-only text-xs font-bold text-ui-primary focus-visible:not-sr-only focus-visible:rounded-[0.375rem] focus-visible:outline-2 focus-visible:outline-ui-primary"
        >
          {open ? "Show less" : "Show all"}
        </TextButton>
      ) : null}
    </div>
  );
}
