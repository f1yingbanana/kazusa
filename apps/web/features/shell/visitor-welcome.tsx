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
import { buttonClass } from "@/ui/button";
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
  { link: socialLink("GitHub"), label: "Make your own" },
  { link: socialLink("Discord"), label: "Join Discord" },
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
          world?.title
            ? `You're watching ${world.title}`
            : "You're watching a live world"
        }
        description="The characters here get on with their lives on their own. You can watch everything they do, but nobody here can see you."
        footer={
          <>
            {OWN_WORLD.map(({ link, label }) => (
              <a
                key={link.title}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ tone: "ghost" })}
              >
                <SocialGlyph link={link} />
                {label}
              </a>
            ))}
            <DialogClose className={buttonClass({ tone: "soft" })}>
              Start watching
            </DialogClose>
          </>
        }
      >
        {note ? (
          <section className="flex flex-col gap-2 rounded-[1rem] bg-ui-accent-tint px-4 py-3.5">
            {note.title ? (
              <h3 className="text-[0.9375rem] font-extrabold">{note.title}</h3>
            ) : null}
            <p className="text-sm leading-normal text-pretty whitespace-pre-line">
              {note.text}
            </p>
            {note.link ? (
              <a
                href={note.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({
                  tone: "primary",
                  className: "self-start",
                })}
              >
                {note.link.label}
                <ExternalLinkIcon aria-hidden />
              </a>
            ) : null}
          </section>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
