import { Suspense } from "react";
import { headers } from "next/headers";
import { parseAuthMode } from "@kazusa/client";
import { SetupGuide } from "@/components/setup/setup-guide";
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
  // Only the desktop has a setup step. A hosted frontend learns whether its
  // world is up from its Gateway, so it never touches local setup machinery.
  const mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
  if (mode === "local" && viewer.role === "owner" && !setup.configured())
    return <SetupGuide status={await setup.status()} />;
  return (
    <Suspense>
      <Shell />
    </Suspense>
  );
}
