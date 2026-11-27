"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect } from "react";
import { useAccess } from "@/hooks/use-access";
import { useSources } from "@/lib/source/provider";
import {
  closeVisitorWelcome,
  openVisitorWelcome,
  useUiStore,
} from "@/lib/state/ui-store";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogPanel } from "@/ui/dialog";
import { SocialGlyph, socialLink, type SocialLink } from "./social-links";

/** Said once per browser; "an observer" in the status bar opens it again. */
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

/** Where a visitor goes for a world of their own; the glyph names the site. */
const OWN_WORLD: readonly { link: SocialLink; label: string }[] = [
  { link: socialLink("GitHub"), label: "GitHub" },
  { link: socialLink("Discord"), label: "Discord" },
];

/**
 * What a visitor to someone's public world is told on arriving: that it is
 * live, that they only watch, and where to get a world of their own. This
 * install's own note to visitors, when it has one, leads.
 */
export function VisitorWelcome() {
  const { open } = useUiStore((state) => state.visitorWelcome);
  const { isReadOnly, isLoading } = useAccess();
  const { world } = useSources();
  const visitor = isReadOnly && !isLoading;
  const known = world !== undefined;
  const note = world?.visitorNote;

  useEffect(() => {
    if (visitor && known && !seen()) openVisitorWelcome();
  }, [visitor, known]);

  const close = () => {
    markSeen();
    closeVisitorWelcome();
  };

  return (
    <Dialog open={open && visitor} onOpenChange={(next) => !next && close()}>
      <DialogPanel
        title={
          note?.title ??
          (world?.title
            ? `You're watching ${world.title}`
            : "You're watching a live world")
        }
        description={
          note
            ? note.text
            : "The characters here get on with their lives on their own. You can watch everything they do, but nobody here can see you."
        }
        footer={
          <>
            {OWN_WORLD.map(({ link, label }) => (
              <Button
                key={link.title}
                tone="ghost"
                icon={<SocialGlyph link={link} />}
                render={
                  <a href={link.href} target="_blank" rel="noopener noreferrer" />
                }
              >
                {label}
              </Button>
            ))}
            <DialogClose render={<Button tone="soft" />}>
              Start watching
            </DialogClose>
          </>
        }
      >
        {note?.link ? (
          <Button
            tone="primary"
            className="self-start"
            icon={<ExternalLinkIcon aria-hidden />}
            render={
              <a
                href={note.link.href}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            {note.link.label}
          </Button>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
