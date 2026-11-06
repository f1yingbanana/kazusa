import { Suspense } from "react";
import { headers } from "next/headers";
import { SetupGuide } from "@/components/setup/setup-guide";
import { Shell } from "@/components/shell/shell";
import { setup } from "@/lib/setup/setup";
import { isAllowedHost, resolveViewer } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function Page() {
  let viewer;
  try {
    viewer = resolveViewer();
    if (!isAllowedHost((await headers()).get("host")))
      return <p>Open Kazusa at localhost.</p>;
  } catch {
    return <p>Kazusa authentication is not configured correctly.</p>;
  }
  // Only the desktop has a setup step. A hosted frontend learns whether its
  // world is up from its Gateway, so it never touches local setup machinery.
  if (viewer.role === "owner" && !setup.configured())
    return <SetupGuide status={await setup.status()} />;
  return (
    <Suspense>
      <Shell />
    </Suspense>
  );
}
