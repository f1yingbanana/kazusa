"use client";

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ui-sdk/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Rows that open in place, any number at once. Each shows its key fact while
 * closed.
 */
export function Folds({ children }: { children: ReactNode }) {
  return (
    <Accordion multiple className="-mx-1 flex flex-col">
      {children}
    </Accordion>
  );
}

export function Fold({
  value,
  title,
  summary,
  children,
}: {
  value: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-t border-ui-line">
      <AccordionHeader className="m-0">
        <AccordionTrigger className="group/fold flex min-h-11 w-full items-center gap-2 rounded-[0.5rem] px-1 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary">
          <span className="shrink-0 text-sm font-extrabold group-hover/fold:text-ui-primary">
            {title}
          </span>
          <span className="min-w-0 flex-1 truncate text-end text-xs text-ui-soft group-aria-expanded/fold:invisible">
            {summary}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-ui-soft transition-transform duration-200 group-aria-expanded/fold:rotate-180"
          />
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel className="px-1 pb-3 text-[0.8125rem]">
        {children}
      </AccordionPanel>
    </AccordionItem>
  );
}
