"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Lingering<T> {
  readonly item: T;
  /** On its way out: drawn for one last move, then gone. */
  readonly leaving: boolean;
}

interface History<T> {
  readonly last: ReadonlyMap<string, T>;
  readonly order: readonly string[];
  readonly gone: ReadonlyMap<
    string,
    { readonly item: T; readonly until: number }
  >;
}

/**
 * Keeps what just left a list on the page for `ms`, marked as leaving, so it
 * can animate out instead of vanishing. Something that comes back before then
 * simply stays. Everything keeps its place in the order: React moving an
 * element would restart its styles and cut its animation short.
 *
 * Rendering reads the history of committed renders and changes nothing; the new
 * history is kept once the render commits, so a render React throws away leaves
 * no trace. One render is asked for when the next item's time is up.
 */
export function useLingering<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  ms: number,
): Lingering<T>[] {
  const committed = useRef<History<T>>({
    last: new Map(),
    order: [],
    gone: new Map(),
  });
  const [, expire] = useState(0);

  const now = performance.now();
  const before = committed.current;
  const current = new Map(items.map((item) => [keyOf(item), item]));
  const gone = new Map(before.gone);
  for (const [key, item] of before.last) {
    if (!current.has(key) && !gone.has(key)) {
      gone.set(key, { item, until: now + ms });
    }
  }
  for (const key of current.keys()) gone.delete(key);
  for (const [key, { until }] of gone) if (until <= now) gone.delete(key);

  // The last order, less what's gone for good, with newcomers after the item
  // they follow in the list now.
  const keys = before.order.filter((key) => current.has(key) || gone.has(key));
  const placed = new Set(keys);
  let after = -1;
  for (const key of current.keys()) {
    if (placed.has(key)) {
      after = keys.indexOf(key);
      continue;
    }
    keys.splice(after + 1, 0, key);
    placed.add(key);
    after += 1;
  }

  const next: History<T> = { last: current, order: keys, gone };
  useLayoutEffect(() => {
    committed.current = next;
  });
  useEffect(() => {
    if (next.gone.size === 0) return;
    const soonest = Math.min(...[...next.gone.values()].map((g) => g.until));
    const timer = setTimeout(
      () => expire((n) => n + 1),
      Math.max(0, soonest - performance.now()) + 1,
    );
    return () => clearTimeout(timer);
  });

  return keys.map((key) =>
    current.has(key)
      ? { item: current.get(key)!, leaving: false }
      : { item: gone.get(key)!.item, leaving: true },
  );
}
