"use client";

import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  ThinkingLevelSchema,
  type ModelOption,
  type ThinkingLevel,
} from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModels } from "@/hooks/use-models";

const DEFAULT = "__default";

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function labelOf(model: ModelOption, level: ThinkingLevel | undefined) {
  if (!level) return undefined;
  return capitalize(
    model.thinkingLevels.find((option) => option.id === level)?.label ?? level,
  );
}

/**
 * How hard every character reasons, stored with the picked model in Kazusa's
 * state and written onto each brain session before its turn (OpenClaw has no
 * per-turn hook for it). The levels are the current model's own; the setting
 * outlives a model switch, and OpenClaw remaps a level the new model lacks to
 * its nearest one.
 */
export function ThinkingPicker() {
  const { enabled, data, setThinking } = useModels();
  const model = data?.models.find((option) => option.ref === data.current);
  if (!enabled || !model || model.thinkingLevels.length < 2) return null;

  const configured = data?.thinking;
  const supported =
    !configured ||
    model.thinkingLevels.some((option) => option.id === configured);
  const modelDefault = labelOf(model, model.thinkingDefault);
  const name = model.alias ?? model.name;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 rounded-full px-2 text-muted-foreground"
                />
              }
            />
          }
        >
          <BrainIcon />
          <span className="text-xs">
            {labelOf(model, configured) ?? modelDefault ?? "Default"}
          </span>
          <ChevronDownIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent>
          {supported
            ? "How hard every character reasons"
            : `${name} has no “${configured}” level; it uses the nearest one`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning Level</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={configured ?? DEFAULT}
            onValueChange={(value: string) => {
              const level = ThinkingLevelSchema.safeParse(value).data ?? null;
              if (level !== (configured ?? null)) void setThinking(level);
            }}
          >
            {model.thinkingLevels.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                closeOnClick
              >
                {capitalize(option.label)}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value={DEFAULT} closeOnClick>
              Default
              {modelDefault ? (
                <span className="text-muted-foreground">{modelDefault}</span>
              ) : null}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
