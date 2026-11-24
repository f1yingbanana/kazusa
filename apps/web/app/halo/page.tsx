import { Suspense } from "react";
import { HaloShell } from "@/components/halo/halo-shell";

export default function HaloPage() {
  return (
    <Suspense>
      <HaloShell />
    </Suspense>
  );
}
