"use client";

import { ImageIcon, ListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatRendering } from "@/lib/scene/rendering";

const OPTIONS = [
  { as: "scene", label: "Scene", icon: ImageIcon },
  { as: "list", label: "Transcript", icon: ListIcon },
] as const;

/**
 * Scene | Transcript for a huddle, in its header: two halves of one control,
 * the current one pressed. Labels show from `sm`; on a phone the icons carry
 * them.
 */
export function SceneSwitch({
  as,
  onChange,
}: {
  as: ChatRendering;
  onChange: (as: ChatRendering) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Show as"
      className="flex shrink-0 rounded-md border"
    >
      {OPTIONS.map((option, index) => (
        <Button
          key={option.as}
          variant={as === option.as ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={as === option.as}
          className={
            index === 0
              ? "rounded-r-none px-2 sm:px-2.5"
              : "rounded-l-none px-2 sm:px-2.5"
          }
          onClick={() => onChange(option.as)}
        >
          <option.icon />
          <span className="sr-only sm:not-sr-only">{option.label}</span>
        </Button>
      ))}
    </div>
  );
}
