"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDownIcon, RefreshCwIcon, Undo2Icon } from "lucide-react";
import type { ModelOption } from "@kazusa/client";
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
import { useModels } from "@/hooks/use-models";
import { cn } from "@/lib/utils";
import {
  PROVIDER_STATUS_LABELS,
  UNAVAILABLE_LABELS,
  formatContext,
  modelName,
  providerLabel,
  refName,
} from "./model-labels";

const INHERIT = "__inherit";

function ModelRow({
  model,
  value,
  checked,
  showProvider = false,
  onSelect,
}: {
  model: ModelOption;
  value: string;
  checked: boolean;
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
      data-checked={checked}
      onSelect={() => onSelect(model)}
    >
      <ModelSelectorLogo
        provider={model.provider}
        className="text-muted-foreground"
      />
      <ModelSelectorName>
        {modelName(model)}
        {showProvider ? (
          <span className="ml-1.5 text-muted-foreground">
            {providerLabel(model.provider)}
          </span>
        ) : null}
      </ModelSelectorName>
      {!model.available && model.unavailableReason ? (
        <span className="text-xs text-muted-foreground">
          {UNAVAILABLE_LABELS[model.unavailableReason]}
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
 * The chat model for one scope: the world default (no `agentId`) or one
 * character. The catalog is whatever the Gateway's providers report; the world
 * config only pins a shortlist. The first entry undoes the scope's choice: a
 * character goes back to following the world, the world to OpenClaw's
 * configured primary.
 *
 * OpenClaw limitation: switching `agents.defaults.model.primary` makes OpenClaw
 * reload every plugin (about ten seconds, Kazusa included), so the choice is
 * kept in Kazusa's state and applied to each brain turn instead. OpenClaw's own
 * tools keep showing `openclaw.json`.
 */
export function ModelPicker({
  agentId,
  id,
  className,
}: {
  agentId?: string;
  /** For a `<label htmlFor>`. */
  id?: string;
  className?: string;
}) {
  const { data, error, isLoading, refreshing, select, refresh } =
    useModels(agentId);
  const world = useModels();
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

  const models = data?.models ?? [];
  const current = models.find((model) => model.ref === data?.current);
  const pinned = models.filter((model) => model.pinned);
  const statusOf = new Map(
    data?.providers.map((entry) => [entry.provider, entry.status]),
  );
  const own = agentId === undefined || data?.overrides?.model !== undefined;

  const inherit =
    agentId !== undefined
      ? world.data?.current && {
          label: "World default",
          target: refName(world.data.models, world.data.current),
          checked: !own,
        }
      : data?.configured &&
        data.configured !== data.current && {
          label: "OpenClaw default",
          target: refName(models, data.configured),
          checked: false,
        };

  // The choice shows at once; `useModels` toasts only when it fails.
  const choose = (ref: string | null) => {
    setOpen(false);
    if (ref === null ? own : ref !== data?.current || !own) void select(ref);
  };

  const unavailable = Boolean(error && !data);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={(isLoading && !data) || unavailable}
            className={cn("w-full min-w-0 justify-start gap-2", className)}
          />
        }
      >
        {isLoading && !data ? (
          <Spinner />
        ) : current ? (
          <ModelSelectorLogo provider={current.provider} />
        ) : null}
        <span className="min-w-0 truncate">
          {unavailable
            ? "Models unavailable"
            : current
              ? modelName(current)
              : (data?.current ?? (isLoading ? "Loading models…" : "No model"))}
        </span>
        {current ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {providerLabel(current.provider)}
          </span>
        ) : null}
        <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title={agentId ? "Chat model for this character" : "Default chat model"}
        className="sm:max-w-md"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList className="max-h-96">
          <ModelSelectorEmpty>No models match.</ModelSelectorEmpty>
          {inherit ? (
            <>
              <ModelSelectorGroup>
                <ModelSelectorItem
                  value={INHERIT}
                  keywords={["default", "inherit", "reset", inherit.target]}
                  data-checked={inherit.checked}
                  onSelect={() => choose(null)}
                >
                  <Undo2Icon className="text-muted-foreground" />
                  <ModelSelectorName>
                    {inherit.label}
                    <span className="ml-1.5 text-muted-foreground">
                      {inherit.target}
                    </span>
                  </ModelSelectorName>
                </ModelSelectorItem>
              </ModelSelectorGroup>
              <ModelSelectorSeparator />
            </>
          ) : null}
          {pinned.length > 0 ? (
            <>
              <ModelSelectorGroup heading="Pinned">
                {pinned.map((model) => (
                  <ModelRow
                    key={model.ref}
                    model={model}
                    value={`pinned:${model.ref}`}
                    checked={own && model.ref === data?.current}
                    showProvider
                    onSelect={(picked) => choose(picked.ref)}
                  />
                ))}
              </ModelSelectorGroup>
              <ModelSelectorSeparator />
            </>
          ) : null}
          {[...byProvider].map(([provider, group]) => {
            const status = statusOf.get(provider);
            return (
              <ModelSelectorGroup
                key={provider}
                heading={
                  status && status !== "ready"
                    ? `${providerLabel(provider)} · ${PROVIDER_STATUS_LABELS[status].toLowerCase()}`
                    : providerLabel(provider)
                }
              >
                {group.map((model) => (
                  <ModelRow
                    key={model.ref}
                    model={model}
                    value={model.ref}
                    checked={own && model.ref === data?.current}
                    onSelect={(picked) => choose(picked.ref)}
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
