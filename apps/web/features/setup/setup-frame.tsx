"use client";

import type { ReactNode } from "react";
import { Logo } from "@/features/shell/logo";
import { useAppearance } from "@/features/shell/use-palette";
import { cx } from "@/ui/cx";

/**
 * Shared canvas for pre-world flows (owner sign-in, outdated world, first-run
 * setup): syncs the active theme palette onto `<html>` and frames the task on a
 * lifted surface card.
 */
export function SetupFrame({
  wide = false,
  uniform = false,
  headerEnd,
  children,
}: {
  wide?: boolean;
  uniform?: boolean;
  headerEnd?: ReactNode;
  children: ReactNode;
}) {
  useAppearance();

  return (
    <main
      className={cx(
        "flex flex-col text-ui-ink sm:min-h-dvh sm:items-center sm:justify-center sm:bg-ui-ground sm:px-6 sm:py-6",
        uniform
          ? "bg-ui-surface max-sm:h-dvh max-sm:overflow-hidden"
          : "min-h-dvh items-center justify-center bg-ui-ground px-4 py-4",
      )}
    >
      <div
        className={cx(
          "flex w-full flex-col",
          uniform
            ? "max-sm:h-full sm:max-w-4xl sm:gap-3"
            : cx("gap-3", wide ? "max-w-4xl" : "max-w-xl"),
        )}
      >
        <header
          className={cx(
            "flex items-center justify-between gap-3",
            uniform
              ? "max-sm:shrink-0 max-sm:border-b max-sm:border-ui-line/60 max-sm:px-4 max-sm:py-3 sm:px-1"
              : "px-1",
          )}
        >
          <Logo />
          {headerEnd}
        </header>
        <section
          className={cx(
            "flex flex-col bg-ui-surface",
            uniform
              ? "min-h-0 flex-1 gap-3 p-4 pb-0 sm:h-[min(39rem,calc(100dvh-5.5rem))] sm:flex-initial sm:gap-4 sm:rounded-3xl sm:p-6 sm:shadow-ui sm:inset-ring sm:inset-ring-ui-line"
              : "gap-4 rounded-3xl p-5 shadow-ui inset-ring inset-ring-ui-line sm:p-6",
          )}
        >
          {children}
        </section>
      </div>
    </main>
  );
}
