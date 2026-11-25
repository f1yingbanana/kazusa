"use client";

import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "./cx";

const Columns = createContext(1);

/** How many columns of at least `min` px, `gap` apart, fit in `width`. */
export function columnsFor(width: number, min: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/**
 * Groups of equal tiles packed on one grid: every group's tiles sit on the same
 * columns and rows, so tiles line up across groups, and a small group fills a
 * gap beside a big one rather than taking a row of its own.
 */
export function PackedGrid({
  min,
  gap = 12,
  className,
  children,
}: {
  /** A column's least width, in px. */
  min: number;
  gap?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setColumns(columnsFor(node.clientWidth, min, gap));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [min, gap]);
  return (
    <Columns value={columns}>
      <div
        ref={ref}
        className={cx("grid grid-flow-row-dense content-start", className)}
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          columnGap: gap,
        }}
      >
        {children}
      </div>
    </Columns>
  );
}

/**
 * One group: its heading over its tiles, as wide as its tiles (the whole grid
 * at most). Headings on a row end at the same line, so the tiles under them
 * start together.
 */
export function PackedGroup({
  label,
  count,
  minSpan = 1,
  head,
  children,
}: {
  label: string;
  count: number;
  /** Columns the heading needs to read, even over fewer tiles. */
  minSpan?: number;
  head: ReactNode;
  children: ReactNode;
}) {
  const columns = use(Columns);
  const span = Math.min(
    columns,
    Math.max(1, minSpan, Math.min(count, columns)),
  );
  const rows = Math.max(1, Math.ceil(count / span));
  return (
    <section
      role="group"
      aria-label={label}
      className="grid grid-cols-subgrid grid-rows-subgrid"
      style={{ gridColumn: `span ${span}`, gridRow: `span ${rows + 1}` }}
    >
      <div className="col-span-full self-end pt-7 pb-3">{head}</div>
      {children}
    </section>
  );
}

/** One tile in a group. */
export function PackedTile({ children }: { children: ReactNode }) {
  return <div className="pb-5">{children}</div>;
}
