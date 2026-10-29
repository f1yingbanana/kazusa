"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import type { ModelOption, ModelProviderStatus } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
} from "@/components/ui/model-selector";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModels } from "@/hooks/use-models";

const PROVIDER_LABELS: Record<string, string> = {
  zai: "Z.AI",
  openrouter: "OpenRouter",
  venice: "Venice",
};

const UNAVAILABLE: Record<
  NonNullable<ModelOption["unavailableReason"]>,
  string
> = {
  "missing-auth": "No key",
  "auth-failed": "Key rejected",
  cooldown: "Cooling down",
};

const PROVIDER_STATUS: Record<
  Exclude<ModelProviderStatus["status"], "ready">,
  string
> = {
  "auth-rejected": "key rejected",
  unavailable: "unavailable",
};

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

function displayName(model: ModelOption) {
  return model.alias ?? model.name;
}

function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

function ModelRow({
  model,
  value,
  current,
  showProvider = false,
  onSelect,
}: {
  model: ModelOption;
  value: string;
  current: string | undefined;
  /** Outside a provider group, say whose model it is. */
  showProvider?: boolean;
  onSelect: (model: ModelOption) => void;
}) {
  return (
    <ModelSelectorItem
      value={value}
      keywords={[
        model.name,
        model.alias ?? "",
        model.ref,
        providerLabel(model.provider),
      ]}
      disabled={!model.available}
      data-checked={model.ref === current}
      onSelect={() => onSelect(model)}
    >
      <ModelSelectorLogo
        provider={model.provider}
        className="text-muted-foreground"
      />
      <ModelSelectorName>
        {displayName(model)}
        {showProvider ? (
          <span className="ml-1.5 text-muted-foreground">
            {providerLabel(model.provider)}
          </span>
        ) : null}
      </ModelSelectorName>
      {!model.available && model.unavailableReason ? (
        <span className="text-xs text-muted-foreground">
          {UNAVAILABLE[model.unavailableReason]}
        </span>
      ) : model.contextWindow ? (
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatContext(model.contextWindow)}
        </span>
      ) : null}
    </ModelSelectorItem>
  );
}

/**
 * The model every character runs on. The catalog is whatever the Gateway's
 * providers report; the world config only pins a shortlist.
 *
 * OpenClaw limitation: switching `agents.defaults.model.primary` makes OpenClaw
 * reload every plugin (about ten seconds, Kazusa included), so the pick is kept
 * in Kazusa's state and applied to each brain turn instead. `openclaw.json`
 * stays the fallback, and OpenClaw's own tools keep showing that one.
 */
export function ModelPicker() {
  const { enabled, data, error, isLoading, refreshing, select, refresh } =
    useModels();
  const [open, setOpen] = useState(false);

  const byProvider = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of data?.models ?? []) {
      const group = groups.get(model.provider);
      if (group) group.push(model);
      else groups.set(model.provider, [model]);
    }
    return groups;
  }, [data?.models]);

  if (!enabled) return null;

  const current = data?.models.find((model) => model.ref === data.current);
  const pinned = data?.models.filter((model) => model.pinned) ?? [];
  const statusOf = new Map(
    data?.providers.map((entry) => [entry.provider, entry.status]),
  );
  const label = current ? displayName(current) : (data?.current ?? "Model");

  // The pick shows at once; `useModels` toasts only when it fails.
  const choose = (model: ModelOption) => {
    setOpen(false);
    if (model.ref !== data?.current) void select(model.ref);
  };

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <ModelSelectorTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLoading && !data}
                />
              }
            />
          }
          className="max-w-44 gap-1.5 rounded-full px-2 text-muted-foreground"
        >
          {current ? <ModelSelectorLogo provider={current.provider} /> : null}
          <span className="truncate text-xs">
            {error && !data ? "Models unavailable" : label}
          </span>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          {error && !data
            ? error.message
            : `Every character runs on ${data?.current ?? "the default model"}`}
        </TooltipContent>
      </Tooltip>
      <ModelSelectorContent
        title="Model for every character"
        className="sm:max-w-md"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList className="max-h-96">
          <ModelSelectorEmpty>No models match.</ModelSelectorEmpty>
          {pinned.length > 0 ? (
            <>
              <ModelSelectorGroup heading="Pinned">
                {pinned.map((model) => (
                  <ModelRow
                    key={model.ref}
                    model={model}
                    value={`pinned:${model.ref}`}
                    current={data?.current}
                    showProvider
                    onSelect={choose}
                  />
                ))}
              </ModelSelectorGroup>
              <ModelSelectorSeparator />
            </>
          ) : null}
          {[...byProvider].map(([provider, models]) => {
            const status = statusOf.get(provider);
            return (
              <ModelSelectorGroup
                key={provider}
                heading={
                  status && status !== "ready"
                    ? `${providerLabel(provider)} · ${PROVIDER_STATUS[status]}`
                    : providerLabel(provider)
                }
              >
                {models.map((model) => (
                  <ModelRow
                    key={model.ref}
                    model={model}
                    value={model.ref}
                    current={data?.current}
                    onSelect={choose}
                  />
                ))}
              </ModelSelectorGroup>
            );
          })}
          <ModelSelectorSeparator />
          <ModelSelectorGroup forceMount>
            <ModelSelectorItem
              value="__refresh"
              forceMount
              disabled={refreshing}
              onSelect={() => void refresh()}
            >
              {refreshing ? <Spinner /> : <RefreshCwIcon />}
              <ModelSelectorName>
                {refreshing ? "Asking providers…" : "Refresh catalog"}
              </ModelSelectorName>
            </ModelSelectorItem>
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
