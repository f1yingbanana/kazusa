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

/**
 * `icon` leads the title, for folds sitting among list rows: it takes the rows'
 * inset too, so titles and separators line up with theirs.
 */
export function Fold({
  value,
  title,
  summary,
  icon,
  children,
}: {
  value: string;
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      data-inset={icon ? "" : undefined}
      className="group/item border-t border-ui-line"
    >
      <AccordionHeader className="m-0">
        <AccordionTrigger className="group/fold flex min-h-11 w-full items-center gap-2 rounded-[0.5rem] px-1 text-start group-data-inset/item:min-h-12 group-data-inset/item:gap-3 group-data-inset/item:px-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary">
          {icon ? (
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center text-ui-soft [&_svg]:size-4.5"
            >
              {icon}
            </span>
          ) : null}
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
      <AccordionPanel className="h-(--accordion-panel-height) overflow-hidden text-[0.8125rem] transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="px-1 pb-3 group-data-inset/item:px-3">{children}</div>
      </AccordionPanel>
    </AccordionItem>
  );
}
