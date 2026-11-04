"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  EllipsisIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { ModelProviderStatus, ProviderSummary } from "@kazusa/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useModels } from "@/hooks/use-models";
import { useProviders } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

/** How long a newly connected row stays lit. */
const FRESH_MS = 1600;

type Status = ModelProviderStatus["status"];

interface Row {
  readonly provider: ProviderSummary;
  /** Models characters can run on, from the catalog. */
  readonly models: number;
  readonly status: Status | undefined;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Where the key comes from, in the user's words. */
function keyLine(provider: ProviderSummary) {
  switch (provider.key) {
    case "profile":
      return "Key saved";
    case "env":
      return "Key from the environment";
    case "config":
      return "Set in OpenClaw settings";
    case "none":
      return "Signed in through OpenClaw";
  }
}

/**
 * One pasted key. It is sent once and never shown again: no route reads a saved
 * key back for the page.
 */
function KeyForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: ProviderSummary;
  onSave: (key: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!key.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(key.trim());
    } catch (failure) {
      setError(describe(failure));
      setSaving(false);
    }
  };

  const field = `key-${provider.id}`;
  return (
    <form
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
      className="flex flex-col gap-2 pt-3"
    >
      <label htmlFor={field} className="sr-only">
        {`${provider.label} API key`}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          ref={input}
          id={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your API key"
          value={key}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${field}-error` : undefined}
          onChange={(event) => setKey(event.target.value)}
          className="min-w-0 flex-1 basis-56 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={!key.trim() || saving}>
          {saving ? <Spinner /> : null}
          {saving ? "Connecting…" : "Save key"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p id={`${field}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : provider.keysUrl ? (
        <a
          href={provider.keysUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-0.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground"
        >
          {`Get a ${provider.label} key`}
          <ArrowUpRightIcon className="size-3" />
        </a>
      ) : null}
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
  onSave: (key: string) => Promise<void>;
  onRemove: () => void;
}) {
  const { provider, models, status } = row;
  const rejected = status === "auth-rejected";
  const unreachable = status === "unavailable";
  // Some providers report a bad key only by listing nothing.
  const empty = !rejected && !unreachable && models === 0;
  const problem = rejected || unreachable || empty;
  return (
    <li
      className={cn(
        "px-3 py-2.5 transition-colors duration-1000 motion-reduce:transition-none",
        fresh && "bg-primary/10 duration-0",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            problem ? "bg-destructive" : "bg-online",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{provider.label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {empty ? "No models found. Check the key." : keyLine(provider)}
          </span>
        </div>
        {empty ? (
          <span className="text-xs text-destructive">No models</span>
        ) : rejected ? (
          <span className="text-xs text-destructive">Key rejected</span>
        ) : unreachable ? (
          <span className="text-xs text-destructive">Can't reach it</span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {models === 1 ? "1 model" : `${models} models`}
          </span>
        )}
        {/* Any other source was set by hand, and stays the user's to change. */}
        {provider.key === "profile" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${provider.label} key options`}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onEdit}>Replace key</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                Remove key
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {editing ? (
        <div className="pl-5">
          <KeyForm provider={provider} onSave={onSave} onCancel={onCancel} />
        </div>
      ) : null}
    </li>
  );
}

function AddRow({
  provider,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  provider: ProviderSummary;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (key: string) => Promise<void>;
}) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{provider.label}</span>
          {provider.hint ? (
            <span className="truncate text-xs text-muted-foreground">
              {provider.hint}
            </span>
          ) : null}
        </div>
        {editing ? null : (
          <Button variant="outline" size="xs" onClick={onEdit}>
            Add key
          </Button>
        )}
      </div>
      {editing ? (
        <KeyForm provider={provider} onSave={onSave} onCancel={onCancel} />
      ) : null}
    </li>
  );
}

/**
 * Connect a model provider by pasting its key. The key becomes an OpenClaw auth
 * profile and the catalog is asked again, so the provider's models are in the
 * pickers before the form closes, with no reload of the page or the Gateway: a
 * profile lives outside `openclaw.json`. Keys wired up by hand (an environment
 * variable, a key in `openclaw.json`) show where they come from and stay the
 * user's to change.
 */
export function ProviderSettings() {
  const providers = useProviders();
  const { data: catalog, refreshing, refresh } = useModels();
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
    const counts = new Map<string, number>();
    for (const model of catalog?.models ?? [])
      if (model.available)
        counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    const statuses = new Map(
      catalog?.providers.map((entry) => [entry.provider, entry.status]),
    );
    return (providers.data?.providers ?? []).map((provider): Row => ({
      provider,
      models: counts.get(provider.id) ?? 0,
      status: statuses.get(provider.id),
    }));
  }, [catalog, providers.data]);

  const connected = rows.filter(
    (row) => row.provider.key !== "none" || row.models > 0,
  );
  const needle = query.trim().toLowerCase();
  const addable = rows
    .filter((row) => !connected.includes(row))
    .filter(
      ({ provider }) =>
        !needle ||
        [provider.label, provider.id, provider.hint ?? ""].some((text) =>
          text.toLowerCase().includes(needle),
        ),
    );

  const save = (provider: ProviderSummary) => async (key: string) => {
    await providers.saveKey({ provider: provider.id, key });
    setEditing(undefined);
    setFresh(provider.id);
  };

  const remove = async (provider: ProviderSummary) => {
    setRemoving(undefined);
    try {
      await providers.removeKey(provider.id);
    } catch (error) {
      toast.error(`Couldn't remove ${provider.label}'s key`, {
        description: describe(error),
      });
    }
  };

  const loading = !providers.data && !providers.error;

  return (
    <SettingsSection
      title="Providers"
      description="Add an API key to use a provider's models."
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? <Spinner /> : <RefreshCwIcon />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {providers.error && !providers.data ? (
        <p className="text-sm text-destructive">{providers.error.message}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">Connected</h4>
        {connected.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
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
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            {loading ? "Loading providers…" : "No providers yet."}
          </p>
        )}
      </div>

      {rows.length > connected.length ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              Add a provider
            </h4>
            <InputGroup className="h-8 w-full sm:w-56">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search providers"
                placeholder="Search providers"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
          </div>
          {addable.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-lg border bg-card">
              {addable.map(({ provider }) => (
                <AddRow
                  key={provider.id}
                  provider={provider}
                  editing={editing === provider.id}
                  onEdit={() => setEditing(provider.id)}
                  onCancel={() => setEditing(undefined)}
                  onSave={save(provider)}
                />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              {`No provider matches "${query.trim()}".`}
            </p>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing ? `Remove ${removing.label}'s key?` : "Remove key?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Characters using its models will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => removing && void remove(removing)}
            >
              Remove key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
