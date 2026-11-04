"use client";

import { ArrowUpRightIcon } from "lucide-react";
import {
  CONTEXT_DOCS_URL,
  ContextSettingsForm,
} from "@/components/context/context-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What every character sends their model each turn. A character can have their
 * own from their inspector, through the same form.
 */
export function ContextSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          How much every character remembers and sends each time they think.
          Bigger numbers remember more and cost more per turn. Any character can
          have their own from their profile.
        </p>
        <a
          href={CONTEXT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ variant: "link", size: "xs" }),
            "self-start px-0 text-muted-foreground",
          )}
        >
          How memory and context work
          <ArrowUpRightIcon />
        </a>
      </div>
      <ContextSettingsForm />
    </div>
  );
}
