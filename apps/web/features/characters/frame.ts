import type { PortraitPlacement } from "@kazusa/client";
import type { PortraitFrame } from "@/ui/portrait";

/** A portrait's frame from its own placement and its set's size. */
export function placedFrame(
  placement: Pick<PortraitPlacement, "centre" | "eyes"> | undefined,
  size: readonly [number, number] | undefined,
  eyeline?: number,
): PortraitFrame {
  return {
    centre: placement?.centre,
    eyes: placement?.eyes ?? eyeline,
    height: size?.[1],
  };
}
