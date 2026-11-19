import { Suspense } from "react";
import { headers } from "next/headers";
import { parseAuthMode } from "@kazusa/client";
import { OwnerGate } from "@/components/auth/owner-sign-in";
import { SetupGuide } from "@/components/setup/setup-guide";
import { StartOver } from "@/components/setup/start-over";
import { Shell } from "@/components/shell/shell";
import { setup } from "@/lib/setup/setup";
import { AuthError, isAllowedHost, resolveViewer } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function Page() {
  let viewer;
  try {
    const reqHeaders = await headers();
    viewer = resolveViewer(reqHeaders);
    if (!isAllowedHost(reqHeaders.get("host")))
      return <p>Open Kazusa at localhost.</p>;
  } catch (err) {
    if (err instanceof AuthError) {
      return <p>{err.message}</p>;
    }
    return <p>Kazusa authentication is not configured correctly.</p>;
  }
  // Only this machine's Kazusa has a setup step: the desktop, or its public
  // frontend (`npm run public`). A hosted frontend learns whether its world is
  // up from its Gateway, so it never touches local setup machinery.
  const mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
  const ownMachine =
    mode === "local" || (mode === "public" && viewer.signIn === true);
  // Kazusa was updated past a world an older version made, or there is none.
  if (ownMachine && (setup.outdated() || !setup.configured())) {
    // Setting up writes keys and downloads worlds: the owner signs in first.
    if (viewer.role !== "owner") return <OwnerGate />;
    if (setup.outdated()) return <StartOver />;
    return <SetupGuide status={await setup.status()} />;
  }
  return (
    <Suspense>
      <Shell />
    </Suspense>
  );
}
