"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAccess } from "@/hooks/use-access";
import { useBridgeAccount } from "@/hooks/use-bridge-account";
import { makeLinkCode, unlinkAccount } from "@/lib/source/bridges/http";
import { SettingsSection } from "./settings-section";

function failed(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/**
 * The person's own Discord account. Linked, what they write in a linked channel
 * is said by whoever they play, in place of their own message. They prove the
 * account is theirs with a code sent from Discord: `/link`, or the code alone
 * in a direct message to the bot.
 */
export function DiscordAccount() {
  const { canManage } = useAccess();
  const [code, setCode] = useState<{ code: string; until: number } | null>(
    null,
  );
  const { data, error, mutate } = useBridgeAccount(code !== null);
  const [busy, setBusy] = useState(false);

  // Linked from Discord while the code was out: done with the code.
  const linked = data?.account;
  useEffect(() => {
    if (!code || !linked || linked.linkedAt < code.until - 10 * 60_000) return;
    setCode(null);
    toast.success(`Linked to ${linked.name}`);
  }, [code, linked]);

  async function start() {
    setBusy(true);
    try {
      setCode(await makeLinkCode());
    } catch (failure) {
      failed("Couldn't make a code", failure);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await mutate(await unlinkAccount(), { revalidate: false });
      toast.success("Unlinked");
    } catch (failure) {
      failed("Couldn't unlink", failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Your Discord account"
      description="Linked, what you write in a linked channel is said by whoever you play here, under their name and picture."
    >
      {error ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t read your account: {error.message}
        </p>
      ) : !data ? (
        <Spinner />
      ) : linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Linked to <span className="font-medium">{linked.name}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void unlink()}
          >
            Unlink
          </Button>
        </div>
      ) : !data.bot ? (
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Connect a bot below first."
            : "The owner hasn't connected a Discord bot yet."}
        </p>
      ) : code ? (
        <div className="flex flex-col gap-3">
          <p
            aria-label="Link code"
            className="font-mono text-2xl font-semibold tracking-[0.2em] select-all"
          >
            {code.code}
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            In Discord, type{" "}
            <code className="font-mono text-xs">/link {code.code}</code> in a
            server {data.bot} is in, or send it the code in a direct message. It
            works for ten minutes, once.
          </p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Waiting for Discord
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setCode(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Link my Discord account
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
