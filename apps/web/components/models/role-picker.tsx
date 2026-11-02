"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import type { RoleModelOption } from "@kazusa/client";
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
  ModelSelectorTrigger,
} from "@/components/ui/model-selector";
import { Spinner } from "@/components/ui/spinner";
import { useProviderLabel } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";

const REASONS: Record<
  NonNullable<RoleModelOption["unavailableReason"]>,
  string
> = {
  "missing-auth": "No key",
};

/**
 * A model role other than chat (decisions, memory search). The same model
 * offered by two providers is listed under each, since whose key pays for it is
 * the choice. `onSelect` may refuse and keep the old pick.
 */
export function RolePicker({
  title,
  options,
  current,
  loading,
  onSelect,
  className,
}: {
  /** Names the picker for screen readers and heads its dialog. */
  title: string;
  options: readonly RoleModelOption[];
  current: string | undefined;
  loading: boolean;
  onSelect: (ref: string) => void;
  className?: string;
}) {
  const providerLabel = useProviderLabel();
  const [open, setOpen] = useState(false);
  const byProvider = useMemo(() => {
    const groups = new Map<string, RoleModelOption[]>();
    for (const option of options) {
      const group = groups.get(option.provider);
      if (group) group.push(option);
      else groups.set(option.provider, [option]);
    }
    return groups;
  }, [options]);
  const selected = options.find((option) => option.ref === current);

  const choose = (ref: string) => {
    setOpen(false);
    if (ref !== current) onSelect(ref);
  };

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger
        render={
          <Button
            aria-label={title}
            variant="outline"
            disabled={loading && options.length === 0}
            className={cn("w-full min-w-0 justify-start gap-2", className)}
          />
        }
      >
        {loading && options.length === 0 ? (
          <Spinner />
        ) : selected ? (
          <ModelSelectorLogo provider={selected.provider} />
        ) : null}
        <span className="min-w-0 truncate">
          {selected?.name ?? current ?? "None"}
        </span>
        {selected ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {providerLabel(selected.provider)}
          </span>
        ) : null}
        <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
      </ModelSelectorTrigger>
      <ModelSelectorContent title={title} className="sm:max-w-md">
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList className="max-h-96">
          <ModelSelectorEmpty>No models match.</ModelSelectorEmpty>
          {[...byProvider].map(([provider, group]) => (
            <ModelSelectorGroup
              key={provider}
              heading={providerLabel(provider)}
            >
              {group.map((option) => (
                <ModelSelectorItem
                  key={option.ref}
                  value={option.ref}
                  keywords={[option.name, option.ref, providerLabel(provider)]}
                  disabled={!option.available}
                  data-checked={option.ref === current}
                  onSelect={() => choose(option.ref)}
                >
                  <ModelSelectorLogo
                    provider={option.provider}
                    className="text-muted-foreground"
                  />
                  <ModelSelectorName>{option.name}</ModelSelectorName>
                  {option.unavailableReason ? (
                    <span className="text-xs text-muted-foreground">
                      {REASONS[option.unavailableReason]}
                    </span>
                  ) : null}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
