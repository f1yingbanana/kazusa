import type { ComponentProps } from "react";
import { cn } from "cn";
import { DialogContent } from "@/components/ui/dialog";

/**
 * A dialog's content: centred from `sm` up, a sheet from the bottom on a phone,
 * where a centred box leaves little room beside the keyboard and the thumb. One
 * element at every width, so rotating a phone keeps what's typed or picked. Use
 * it inside `Dialog` with the dialog's own header, title, description and
 * footer. Sizes meant for the centred box take an `sm:` prefix.
 */
export function ResponsiveDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:translate-0 max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}
