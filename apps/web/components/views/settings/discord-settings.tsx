"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { BridgeStatus } from "@kazusa/client";
import { ChatChip } from "@/components/entities/chips";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useBridges } from "@/hooks/use-bridges";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

const STATUS_LABEL: Record<BridgeStatus["state"], string> = {
  off: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  failed: "Couldn't connect",
};

function Status({ status }: { status: BridgeStatus }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          status.state === "connected"
            ? "bg-online"
            : status.state === "failed"
              ? "bg-destructive"
              : status.state === "connecting"
                ? "animate-pulse bg-muted-foreground motion-reduce:animate-none"
                : "bg-muted-foreground/40",
        )}
      />
      <div className="flex min-w-0 flex-col">
        <span role="status" className="text-sm font-medium">
          {STATUS_LABEL[status.state]}
        </span>
        {status.state === "connected" ? (
          <span className="text-xs text-muted-foreground">
            As {status.name}
          </span>
        ) : status.state === "failed" ? (
          <span className="text-xs text-pretty text-muted-foreground">
            {status.error.replace(/^Error: /, "")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Discord bot that links groups to channels: its token, kept with the
 * provider keys and never shown again, and which groups are linked. A group is
 * linked from its chat sidebar.
 */
export function DiscordSettings() {
  const { data, error, saveToken } = useBridges();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(next: string | null) {
    setSaving(true);
    try {
      await saveToken(next);
      setToken("");
    } catch (failure) {
      toast.error("Couldn't save the token", {
        description:
          failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t read the Discord settings: {error.message}
      </p>
    );
  if (!data) return <Spinner />;

  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Bot"
        description="One bot posts for every character, each under their own name and picture, in the channels you link to groups. People writing there are guests in the group."
      >
        <Status status={data.discord.status} />
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim()) void save(token.trim());
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="discord-token">
                {data.discord.hasToken ? "Replace the bot token" : "Bot token"}
              </FieldLabel>
              <Input
                id="discord-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={data.discord.hasToken ? "Saved" : undefined}
              />
              <FieldDescription>
                From your application&apos;s Bot page in the Discord Developer
                Portal. Switch on the Message Content intent there, and invite
                the bot with View Channels, Send Messages, Read Message History
                and Manage Webhooks. Saved on this computer with your provider
                keys, and never shown again.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!token.trim() || saving}>
              {saving ? <Spinner /> : null}
              {data.discord.hasToken ? "Replace and connect" : "Connect"}
            </Button>
            {data.discord.hasToken ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => void save(null)}
              >
                Remove token
              </Button>
            ) : null}
          </div>
        </form>
      </SettingsSection>
      <SettingsSection
        title="Linked groups"
        description="Link a group from its chat sidebar, with the channel's ID (right-click the channel in Discord with Developer Mode on, then Copy Channel ID)."
      >
        {data.links.length ? (
          <ul className="flex flex-col gap-2">
            {data.links.map((link) => (
              <li
                key={link.chatId}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <ChatChip id={link.chatId} />
                <span className="text-muted-foreground">
                  ↔ channel{" "}
                  <code className="font-mono text-xs">{link.channelId}</code>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No group is linked yet.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
