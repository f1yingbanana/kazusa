"use client";

import { ThinkingLevelSchema, type RoleModelOption } from "@kazusa/client";
import { BrainIcon, RefreshCwIcon, Undo2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useModels } from "@/hooks/use-models";
import { useProviderLabel } from "@/hooks/use-providers";
import { Button } from "@/ui/button";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandTrigger,
} from "@/ui/command";
import { ProviderLogo } from "@/ui/provider-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/ui/select";
import {
  PROVIDER_STATUS_LABELS,
  UNAVAILABLE_LABELS,
  formatContext,
  modelName,
  refName,
  thinkingLabel,
} from "./model-labels";

const INHERIT = "__inherit";

function groupByProvider<T extends { readonly provider: string }>(
  items: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.provider);
    if (group) group.push(item);
    else groups.set(item.provider, [item]);
  }
  return groups;
}

export function ModelPicker({
  agentId,
  label = "Chat model",
  className,
}: {
  agentId?: string;
  label?: string;
  className?: string;
}) {
  const { data, error, isLoading, refreshing, select, refresh } =
    useModels(agentId);
  const world = useModels();
  const providerLabel = useProviderLabel();
  const [open, setOpen] = useState(false);

  const models = data?.models ?? (agentId ? (world.data?.models ?? []) : []);
  const byProvider = useMemo(() => groupByProvider(models), [models]);
  const current = models.find((model) => model.ref === data?.current);
  const statusOf = new Map(
    (data?.providers ?? world.data?.providers ?? []).map((entry) => [
      entry.provider,
      entry.status,
    ]),
  );
  const own = agentId === undefined || data?.overrides?.model !== undefined;
  const canReset = own || !data;

  const inherit =
    agentId !== undefined
      ? world.data?.current && {
          label: "World default",
          target: refName(world.data.models, world.data.current),
          checked: Boolean(data) && !own,
        }
      : data?.configured &&
        data.configured !== data.current && {
          label: "OpenClaw default",
          target: refName(models, data.configured),
          checked: false,
        };

  const choose = (ref: string | null) => {
    setOpen(false);
    if (ref === null ? canReset : ref !== data?.current || !own)
      void select(ref);
  };

  const unavailable = Boolean(
    error && !data && (!agentId || !world.data?.models?.length),
  );

  return (
    <>
      <CommandTrigger
        label={label}
        pending={isLoading && !data}
        disabled={unavailable}
        onClick={() => setOpen(true)}
        className={className}
        icon={
          current ? <ProviderLogo provider={current.provider} /> : undefined
        }
        hint={current ? providerLabel(current.provider) : undefined}
      >
        {unavailable
          ? "Models unavailable"
          : current
            ? modelName(current)
            : data?.current
              ? `${refName(models, data.current)} (unreachable)`
              : isLoading
                ? "Loading models…"
                : "No model"}
      </CommandTrigger>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={agentId ? "Chat model for this character" : "Default chat model"}
        label="Search chat models"
        placeholder="Search models…"
        empty="No models match."
        footer={
          <Button
            type="button"
            tone="ghost"
            size="sm"
            pending={refreshing}
            icon={<RefreshCwIcon aria-hidden />}
            onClick={() => void refresh()}
            className="w-full justify-start"
          >
            Refresh catalog
          </Button>
        }
      >
        {inherit ? (
          <CommandGroup label="Default">
            <CommandItem
              value={INHERIT}
              label={inherit.label}
              keywords={["default", "inherit", "reset", inherit.target]}
              hint={inherit.target}
              checked={inherit.checked}
              icon={<Undo2Icon aria-hidden />}
              onSelect={() => choose(null)}
            >
              {inherit.label}
            </CommandItem>
          </CommandGroup>
        ) : null}

        {[...byProvider].map(([provider, group]) => {
          const status = statusOf.get(provider);
          const heading =
            status && status !== "ready"
              ? `${providerLabel(provider)} · ${PROVIDER_STATUS_LABELS[status].toLowerCase()}`
              : providerLabel(provider);
          return (
            <CommandGroup key={provider} label={heading}>
              {group.map((model) => (
                <CommandItem
                  key={model.ref}
                  value={model.ref}
                  label={modelName(model)}
                  keywords={[
                    model.name,
                    model.alias ?? "",
                    model.ref,
                    providerLabel(model.provider),
                  ]}
                  disabled={!model.available}
                  checked={own && model.ref === data?.current}
                  icon={
                    <ProviderLogo
                      provider={model.provider}
                      className="text-ui-soft"
                    />
                  }
                  trailing={
                    !model.available && model.unavailableReason ? (
                      <span className="text-xs text-ui-soft">
                        {UNAVAILABLE_LABELS[model.unavailableReason]}
                      </span>
                    ) : model.contextWindow ? (
                      <span className="font-[ui-monospace,monospace] text-xs text-ui-soft tabular-nums">
                        {formatContext(model.contextWindow)}
                      </span>
                    ) : null
                  }
                  onSelect={() => choose(model.ref)}
                >
                  {modelName(model)}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandDialog>
    </>
  );
}

export function ThinkingPicker({
  agentId,
  label = "Reasoning",
  className,
}: {
  agentId?: string;
  label?: string;
  className?: string;
}) {
  const { data, setThinking } = useModels(agentId);
  const world = useModels();
  const model = data?.models.find((option) => option.ref === data.current);
  if (!model || model.thinkingLevels.length < 2) return null;

  const effective = data?.thinking;
  const chosen = agentId === undefined ? effective : data?.overrides?.thinking;
  const modelDefault = thinkingLabel(model, model.thinkingDefault);
  const inherit =
    agentId === undefined
      ? { label: "Model default", hint: modelDefault }
      : {
          label: "World default",
          hint: thinkingLabel(model, world.data?.thinking) ?? modelDefault,
        };

  const items = [
    ...model.thinkingLevels.map((option) => ({
      value: option.id,
      label: thinkingLabel(model, option.id) ?? option.id,
    })),
    {
      value: INHERIT,
      label: inherit.hint
        ? `${inherit.label} (${inherit.hint})`
        : inherit.label,
    },
  ];

  return (
    <Select<string>
      items={items}
      value={chosen ?? INHERIT}
      onValueChange={(next) => {
        if (!next) return;
        const level = ThinkingLevelSchema.safeParse(next).data ?? null;
        if (level !== (chosen ?? null)) void setThinking(level);
      }}
    >
      <SelectTrigger aria-label={label} className={className}>
        <span className="flex min-w-0 items-center gap-2">
          <BrainIcon aria-hidden className="size-4 shrink-0 text-ui-soft" />
          <span className="truncate">
            {thinkingLabel(model, effective) ?? modelDefault ?? "Default"}
          </span>
          {!chosen ? (
            <span className="shrink-0 text-xs font-normal text-ui-soft">
              {inherit.label}
            </span>
          ) : null}
        </span>
      </SelectTrigger>
      <SelectContent>
        {model.thinkingLevels.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {thinkingLabel(model, option.id)}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={INHERIT}>
          <span className="flex items-baseline gap-2">
            <span>{inherit.label}</span>
            {inherit.hint ? (
              <span className="text-xs font-normal text-ui-soft">
                {inherit.hint}
              </span>
            ) : null}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

const ROLE_REASONS: Record<
  NonNullable<RoleModelOption["unavailableReason"]>,
  string
> = {
  "missing-auth": "No key",
};

export function RolePicker({
  title,
  options,
  current,
  loading,
  onSelect,
  className,
}: {
  title: string;
  options: readonly RoleModelOption[];
  current: string | undefined;
  loading: boolean;
  onSelect: (ref: string) => void;
  className?: string;
}) {
  const providerLabel = useProviderLabel();
  const [open, setOpen] = useState(false);

  const byProvider = useMemo(() => groupByProvider(options), [options]);

  const selected = options.find((option) => option.ref === current);

  return (
    <>
      <CommandTrigger
        label={title}
        pending={loading && options.length === 0}
        onClick={() => setOpen(true)}
        className={className}
        icon={
          selected ? <ProviderLogo provider={selected.provider} /> : undefined
        }
        hint={selected ? providerLabel(selected.provider) : undefined}
      >
        {selected?.name ?? current ?? "None"}
      </CommandTrigger>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        label={`Search ${title.toLowerCase()}`}
        placeholder="Search models…"
        empty="No models match."
      >
        {[...byProvider].map(([provider, group]) => (
          <CommandGroup key={provider} label={providerLabel(provider)}>
            {group.map((option) => (
              <CommandItem
                key={option.ref}
                value={option.ref}
                label={option.name}
                keywords={[option.name, option.ref, providerLabel(provider)]}
                disabled={!option.available}
                checked={option.ref === current}
                icon={
                  <ProviderLogo
                    provider={option.provider}
                    className="text-ui-soft"
                  />
                }
                trailing={
                  option.unavailableReason ? (
                    <span className="text-xs text-ui-soft">
                      {ROLE_REASONS[option.unavailableReason]}
                    </span>
                  ) : null
                }
                onSelect={() => {
                  setOpen(false);
                  if (option.ref !== current) onSelect(option.ref);
                }}
              >
                {option.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandDialog>
    </>
  );
}
