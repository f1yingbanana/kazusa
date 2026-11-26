"use client";

import type { ModelProviderStatus, ProviderSummary } from "@kazusa/client";
import { ArrowUpRightIcon, EllipsisIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDecisionModels, useEmbeddingModels } from "@/hooks/use-model-roles";
import { useModels } from "@/hooks/use-models";
import { useProviders } from "@/hooks/use-providers";
import { Button, IconButton } from "@/ui/button";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { PasswordField } from "@/ui/field";
import { SearchInput } from "@/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/ui/menu";
import { Note } from "@/ui/note";
import {
  Callout,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  StatusDot,
} from "@/ui/settings";
import { failureText } from "./model-labels";

const FRESH_MS = 1600;

type Status = ModelProviderStatus["status"];

interface Row {
  readonly provider: ProviderSummary;
  readonly models: number;
  readonly status: Status | undefined;
}

function keyLine(provider: ProviderSummary): string {
  switch (provider.key) {
    case "profile":
      return provider.local ? "Connected" : "Key saved";
    case "env":
      return "Key from the environment";
    case "config":
      return "Set in OpenClaw settings";
    case "none":
      return "Signed in through OpenClaw";
  }
}

function KeyForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: ProviderSummary;
  onSave: (key?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const optional = provider.local === true;
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if ((!key.trim() && !optional) || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(key.trim() || undefined);
    } catch (failure) {
      setError(failureText(failure));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
      className="flex flex-col gap-2.5"
    >
      <PasswordField
        label={`${provider.label} API key`}
        labelHidden
        autoFocus
        placeholder={optional ? "API key (optional)" : "Paste your API key"}
        value={key}
        disabled={saving}
        error={error}
        onValueChange={(next) => {
          setKey(next);
          setError(undefined);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          tone="primary"
          size="sm"
          pending={saving}
          disabled={!key.trim() && !optional}
        >
          {key.trim() ? "Save key" : "Connect"}
        </Button>
        <Button
          type="button"
          tone="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {provider.keysUrl ? (
          <a
            href={provider.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="ms-auto inline-flex items-center gap-0.5 text-xs font-semibold text-ui-soft underline-offset-4 hover:text-ui-ink hover:underline"
          >
            {optional ? `Get ${provider.label}` : `Get a ${provider.label} key`}
            <ArrowUpRightIcon aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>
    </form>
  );
}

function ConnectedRow({
  row,
  editing,
  fresh,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  row: Row;
  editing: boolean;
  fresh: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (key?: string) => Promise<void>;
  onRemove: () => void;
}) {
  const { provider, models, status } = row;
  const local = provider.local === true;
  const rejected = status === "auth-rejected";
  const unreachable = status === "unavailable";
  const empty = !rejected && !unreachable && models === 0;
  const problem = rejected || unreachable || empty;

  return (
    <SettingsRow
      fresh={fresh}
      icon={<StatusDot tone={problem ? "error" : "ok"} />}
      title={provider.label}
      detail={
        !empty ? (
          keyLine(provider)
        ) : local ? (
          <>
            {`No models found. Is ${provider.label} running? `}
            {provider.keysUrl ? (
              <a
                href={provider.keysUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-ui-ink"
              >
                {`Get ${provider.label}`}
              </a>
            ) : null}
          </>
        ) : (
          "No models found. Check the key."
        )
      }
      action={
        <>
          {empty ? (
            <span className="text-xs font-semibold text-ui-danger">
              No models
            </span>
          ) : rejected ? (
            <span className="text-xs font-semibold text-ui-danger">
              Key rejected
            </span>
          ) : unreachable ? (
            <span className="text-xs font-semibold text-ui-danger">
              Can&apos;t reach it
            </span>
          ) : (
            <span className="font-[ui-monospace,monospace] text-xs text-ui-soft tabular-nums">
              {models === 1 ? "1 model" : `${models} models`}
            </span>
          )}
          {provider.key === "profile" ? (
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    label={`${provider.label} key options`}
                    size="sm"
                  />
                }
              >
                <EllipsisIcon aria-hidden />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onClick={onEdit}>
                  {local ? "Set a key" : "Replace key"}
                </MenuItem>
                <MenuItem danger onClick={onRemove}>
                  {local ? "Disconnect" : "Remove key"}
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </>
      }
    >
      {editing ? (
        <KeyForm provider={provider} onSave={onSave} onCancel={onCancel} />
      ) : null}
    </SettingsRow>
  );
}

export function ProviderSettings() {
  const providers = useProviders();
  const { data: catalog, refreshing, refresh } = useModels();
  const decision = useDecisionModels();
  const embedding = useEmbeddingModels();
  const [editing, setEditing] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  const [removing, setRemoving] = useState<ProviderSummary>();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(undefined), FRESH_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  const rows = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const model of [
      ...(catalog?.models ?? []),
      ...(decision.data?.options ?? []),
      ...(embedding.data?.options ?? []),
    ]) {
      if (!model.available) continue;
      let refs = counts.get(model.provider);
      if (!refs) {
        refs = new Set();
        counts.set(model.provider, refs);
      }
      refs.add(model.ref);
    }
    const statuses = new Map(
      catalog?.providers.map((entry) => [entry.provider, entry.status]),
    );
    return (providers.data?.providers ?? []).map((provider): Row => ({
      provider,
      models: counts.get(provider.id)?.size ?? 0,
      status: statuses.get(provider.id),
    }));
  }, [catalog, decision.data, embedding.data, providers.data]);

  const connected = rows.filter(
    (row) => row.provider.key !== "none" || row.models > 0,
  );
  const needle = query.trim().toLowerCase();
  const addable = rows
    .filter((row) => !connected.includes(row))
    .filter(
      ({ provider }) =>
        !needle ||
        [provider.label, provider.id].some((text) =>
          text.toLowerCase().includes(needle),
        ),
    );

  const save = (provider: ProviderSummary) => async (key?: string) => {
    await providers.saveKey({ provider: provider.id, ...(key ? { key } : {}) });
    setEditing(undefined);
    setFresh(provider.id);
  };

  const remove = async (provider: ProviderSummary) => {
    setRemoving(undefined);
    try {
      await providers.removeKey(provider.id);
    } catch (error) {
      toast.error(
        provider.local
          ? `Couldn't disconnect ${provider.label}`
          : `Couldn't remove ${provider.label}'s key`,
        { description: failureText(error) },
      );
    }
  };

  const loading = !providers.data && !providers.error;

  return (
    <SettingsSection
      title="Providers"
      description="Add an API key to enable a provider's models. Keys stay on this computer."
      action={
        <Button
          tone="soft"
          size="sm"
          pending={refreshing}
          icon={<RefreshCwIcon aria-hidden />}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      }
    >
      {providers.error && !providers.data ? (
        <Callout tone="danger" title="Couldn't load providers">
          {providers.error.message}
        </Callout>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-extrabold text-ui-soft">Connected</h3>
        {connected.length > 0 ? (
          <SettingsGroup>
            {connected.map((row) => (
              <ConnectedRow
                key={row.provider.id}
                row={row}
                editing={editing === row.provider.id}
                fresh={fresh === row.provider.id}
                onEdit={() => setEditing(row.provider.id)}
                onCancel={() => setEditing(undefined)}
                onSave={save(row.provider)}
                onRemove={() => setRemoving(row.provider)}
              />
            ))}
          </SettingsGroup>
        ) : (
          <div className="rounded-[1rem] border border-dashed border-ui-line p-4">
            <Note>{loading ? "Loading providers…" : "No providers yet."}</Note>
          </div>
        )}
      </div>

      {rows.length > connected.length ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-ui-soft">
              Add a provider
            </h3>
            <SearchInput
              aria-label="Search providers"
              placeholder="Search providers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 flex-none sm:w-56"
            />
          </div>
          {addable.length > 0 ? (
            <SettingsGroup>
              {addable.map(({ provider }) => {
                const isEditing = editing === provider.id;
                return (
                  <SettingsRow
                    key={provider.id}
                    title={provider.label}
                    action={
                      isEditing ? null : (
                        <Button
                          tone="soft"
                          size="sm"
                          onClick={() => setEditing(provider.id)}
                        >
                          Add key
                        </Button>
                      )
                    }
                  >
                    {isEditing ? (
                      <KeyForm
                        provider={provider}
                        onSave={save(provider)}
                        onCancel={() => setEditing(undefined)}
                      />
                    ) : null}
                  </SettingsRow>
                );
              })}
            </SettingsGroup>
          ) : (
            <Note>{`No provider matches "${query.trim()}".`}</Note>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <AlertPanel
          danger
          title={
            !removing
              ? "Remove key?"
              : removing.local
                ? `Disconnect ${removing.label}?`
                : `Remove ${removing.label}'s key?`
          }
          description="Characters using its models will stop working until another key or model is picked."
          agentConfirm={
            removing
              ? `Removes ${removing.label}'s key from OpenClaw`
              : "Removes the provider key"
          }
          onConfirm={() => removing && void remove(removing)}
        />
      </AlertDialog>
    </SettingsSection>
  );
}
