import { Suspense } from "react";
import { Shell } from "@/features/shell/shell";

/** The new client, built here until it replaces the root page. */
export default function NewClientPage() {
  return (
    <Suspense>
      <Shell />
    </Suspense>
  );
}
