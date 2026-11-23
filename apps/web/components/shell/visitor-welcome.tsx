"use client";

import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccess } from "@/hooks/use-access";
import { useSources } from "@/lib/source/provider";
import { cn } from "@/lib/utils";
import {
  closeVisitorWelcome,
  openVisitorWelcome,
  useUiStore,
} from "@/lib/state/ui-store";
import { SocialGlyph, socialLink, type SocialLink } from "./social-links";

/** Said once per browser; the status bar's "an observer" opens it again. */
const SEEN_KEY = "kazusa.visitor-welcome.seen";

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Storage is blocked: better said every visit than never.
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Said again next time; harmless.
  }
}

/** Where a visitor goes for a world of their own, each said in words. */
const OWN_WORLD: readonly { link: SocialLink; label: string }[] = [
  { link: socialLink("GitHub"), label: "Get Kazusa on GitHub" },
  { link: socialLink("Discord"), label: "Join the Discord" },
];

/**
 * What a visitor to someone's public world is told on arriving: that it is
 * live, that they only watch, and where to get a world of their own. Never
 * shown to anyone who can play here.
 */
export function VisitorWelcome() {
  const { open } = useUiStore((state) => state.visitorWelcome);
  const { isReadOnly, isLoading } = useAccess();
  const { world } = useSources();
  const visitor = isReadOnly && !isLoading;
  const known = world !== undefined;

  useEffect(() => {
    if (visitor && known && !seen()) openVisitorWelcome();
  }, [visitor, known]);

  const close = () => {
    markSeen();
    closeVisitorWelcome();
  };

  return (
    <Dialog open={open && visitor} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {world?.title
              ? `You're watching ${world.title}`
              : "You're watching a live world"}
          </DialogTitle>
          <DialogDescription>
            Everyone here lives their own day: they make plans, go places, and
            talk and text each other, right now. You are an observer. Look
            anywhere and open any conversation; nothing you do reaches them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Want a world of your own to play in? This one runs on Kazusa, which
            is free and open source.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {OWN_WORLD.map(({ link, label }) => (
              <a
                key={link.title}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "flex-1 gap-2",
                )}
              >
                <SocialGlyph link={link} />
                {label}
              </a>
            ))}
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Start watching</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
