"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The inspector's one design language, shared by every section:
 *
 * - One family: the app's sans; mono only for clock times and durations, at
 *   `text-xs`;
 * - Section titles in bold capitals, `text-xs font-semibold`, spaced, muted;
 * - Values `text-sm`, secondary text `text-xs` muted;
 * - A section's actions (more of it, or somewhere else) are small ghost buttons
 *   in one row at its bottom, aligned with its text on the left.
 */
export const SECTION_TITLE =
  "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

/**
 * A section's actions, at its bottom. Pulled back by a button's padding, so
 * their words line up with the section's text.
 */
export function SectionActions({ children }: { children: React.ReactNode }) {
  return <div className="-ml-2 flex flex-wrap gap-1">{children}</div>;
}

/** One action: more of the section, or the place it leads to. */
export function SectionAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}
