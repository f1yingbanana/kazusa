"use client";

import { EyeIcon } from "lucide-react";
import { useAccess } from "@/hooks/use-access";

export function ReadOnlyStatusItem() {
  const { isReadOnly, isLoading } = useAccess();
  if (isLoading || !isReadOnly) return null;

  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <EyeIcon className="size-3" aria-hidden />
      <span>View only</span>
    </span>
  );
}
