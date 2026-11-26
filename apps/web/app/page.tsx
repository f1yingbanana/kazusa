import { Suspense } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { parseAuthMode } from "@kazusa/client";
import { OwnerGate } from "@/components/auth/owner-sign-in";
import { SetupGuide } from "@/components/setup/setup-guide";
import { StartOver } from "@/components/setup/start-over";
import { Shell } from "@/features/shell/shell";
import { setup } from "@/lib/setup/setup";
import { AuthError, isAllowedHost, resolveViewer } from "@/lib/auth/access";

/**
 * Who is looking decides everything here, so all of it is read per request,
 * inside the boundary; the shell around it is the same for everyone.
 */
export default function Page() {
  return (
    <Suspense>
      <Entry />
    </Suspense>
  );
}

async function Entry() {
  // Only ever for the request at hand: who is signed in is checked against the
  // time, and whether a world is set up is read off the disk.
  await connection();
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
  return <Shell />;
}
