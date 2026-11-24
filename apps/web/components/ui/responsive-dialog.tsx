"use client";

import type { ComponentProps } from "react";
import { cn } from "cn";
import { DialogContent } from "@/components/ui/dialog";
import { SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Below Tailwind's `sm`: a phone. */
const PHONE = "(max-width: 639px)";

/**
 * A dialog's content: centred on wider screens, a sheet from the bottom on a
 * phone, where a centred box leaves little room beside the keyboard and the
 * thumb. Use it inside `Dialog` with the dialog's own header, title,
 * description and footer: a sheet is the same primitive. Sizes meant for the
 * centred box take an `sm:` prefix.
 */
export function ResponsiveDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  const phone = useMediaQuery(PHONE);
  if (!phone) return <DialogContent className={className} {...props} />;
  return (
    <SheetContent
      side="bottom"
      className={cn(
        "max-h-[85dvh] rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}
