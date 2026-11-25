"use client";

import { useRef } from "react";

export interface Lingering<T> {
  readonly item: T;
  /** On its way out: drawn for one last move, then gone. */
  readonly leaving: boolean;
}

/**
 * Keeps what just left a list on the page for `ms`, marked as leaving, so it
 * can animate out instead of vanishing. Something that comes back before then
 * simply stays. Everything keeps its place in the order: React moving an
 * element would restart its styles and cut its animation short.
 */
export function useLingering<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  ms: number,
): Lingering<T>[] {
  const last = useRef(new Map<string, T>());
  const order = useRef<string[]>([]);
  const gone = useRef(new Map<string, { item: T; until: number }>());

  const now = performance.now();
  const current = new Map(items.map((item) => [keyOf(item), item]));
  for (const [key, item] of last.current) {
    if (!current.has(key) && !gone.current.has(key)) {
      gone.current.set(key, { item, until: now + ms });
    }
  }
  for (const key of current.keys()) gone.current.delete(key);
  for (const [key, { until }] of gone.current)
    if (until <= now) gone.current.delete(key);
  last.current = current;

  // The last order, less what's gone for good, with newcomers after the item
  // they follow in the list now.
  const keys = order.current.filter(
    (key) => current.has(key) || gone.current.has(key),
  );
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
  order.current = keys;

  return keys.map((key) =>
    current.has(key)
      ? { item: current.get(key)!, leaving: false }
      : { item: gone.current.get(key)!.item, leaving: true },
  );
}
