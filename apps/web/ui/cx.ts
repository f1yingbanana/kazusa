import { twMerge } from "tailwind-merge";

/**
 * Joins class names; a later Tailwind class wins over an earlier one it
 * conflicts with.
 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return twMerge(names.filter(Boolean).join(" "));
}
