"use client";

import { SearchIcon } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import { TextButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { WorldValues } from "../stats/world-values";
import { Clock } from "./clock/clock";
import { Logo } from "./logo";
import { MoreMenu } from "./more-menu";
import { SavesButton } from "./saves-dialog";
import { SocialLinks } from "./social-links";

/**
 * The world right now, centred: its time and how fast it runs, saving it, and
 * its own states. Finding things and the community sit at the end. On a phone
 * everything but the clock folds into More.
 */
export function TopBar({
  onOpenCommand,
  onOpenDetails,
  className,
}: {
  onOpenCommand: () => void;
  onOpenDetails: () => void;
  className?: string;
}) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const { resolved } = useSources();
  return (
    <header
      className={cx(
        "grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-5 px-5 py-3 max-md:gap-2 max-md:px-3 max-md:py-2",
        className,
      )}
    >
      <Logo />
      <div className="flex min-w-0 items-center gap-1.5">
        <Clock />
        {phone ? null : (
          <>
            <SavesButton />
            {satisfies(resolved, ["stats"]) ? <WorldValues /> : null}
          </>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        {phone ? (
          <MoreMenu
            onOpenCommand={onOpenCommand}
            onOpenDetails={onOpenDetails}
          />
        ) : (
          <>
            <TextButton
              className="me-2 inline-flex h-10 items-center gap-2 rounded-full bg-ui-surface ps-3.5 pe-2 text-sm whitespace-nowrap text-ui-soft inset-ring inset-ring-ui-line hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary max-lg:w-10 max-lg:justify-center max-lg:px-0 [&_svg]:size-4"
              aria-label="Search anything"
              aria-keyshortcuts="Meta+K Control+K"
              onClick={onOpenCommand}
            >
              <SearchIcon aria-hidden />
              <span className="max-lg:hidden">Search anything</span>
              <kbd className="rounded-full bg-ui-tint px-2 py-0.5 font-[inherit] text-xs max-lg:hidden">
                ⌘K
              </kbd>
            </TextButton>
            <SocialLinks />
          </>
        )}
      </div>
    </header>
  );
}
