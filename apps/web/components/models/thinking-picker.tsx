"use client";

import { BrainIcon, ChevronsUpDownIcon } from "lucide-react";
import { ThinkingLevelSchema } from "@kazusa/client";
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
import { cn } from "@/lib/utils";
import { modelName, thinkingLabel } from "./model-labels";

const INHERIT = "__inherit";

/**
 * How hard one scope reasons: the world default (no `agentId`) or one
 * character. Stored with the model choice in Kazusa's state and written onto
 * each brain session before its turn (OpenClaw has no per-turn hook for it).
 * The levels are the effective model's own; the setting outlives a model
 * switch, and OpenClaw remaps a level the new model lacks to its nearest one.
 */
export function ThinkingPicker({
  agentId,
  id,
  className,
}: {
  agentId?: string;
  /** For a `<label htmlFor>`. */
  id?: string;
  className?: string;
}) {
  const { data, setThinking } = useModels(agentId);
  const world = useModels();
  const model = data?.models.find((option) => option.ref === data.current);
  if (!model) return null;

  const name = modelName(model);
  if (model.thinkingLevels.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">{`${name} has no reasoning levels to choose from.`}</p>
    );
  }

  const effective = data?.thinking;
  const chosen = agentId === undefined ? effective : data?.overrides?.thinking;
  const supported =
    !effective ||
    model.thinkingLevels.some((option) => option.id === effective);
  const modelDefault = thinkingLabel(model, model.thinkingDefault);
  const inherit =
    agentId === undefined
      ? { label: "Model default", hint: modelDefault }
      : {
          label: "World default",
          hint: thinkingLabel(model, world.data?.thinking) ?? modelDefault,
        };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  id={id}
                  variant="outline"
                  className={cn(
                    "w-full min-w-0 justify-start gap-2",
                    className,
                  )}
                />
              }
            />
          }
        >
          <BrainIcon className="text-muted-foreground" />
          <span className="min-w-0 truncate">
            {thinkingLabel(model, effective) ?? modelDefault ?? "Default"}
          </span>
          {!chosen ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {inherit.label}
            </span>
          ) : null}
          <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          {supported
            ? `Levels ${name} offers`
            : `${name} has no “${effective}” level; it uses the nearest one`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning level</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={chosen ?? INHERIT}
            onValueChange={(value: string) => {
              const level = ThinkingLevelSchema.safeParse(value).data ?? null;
              if (level !== (chosen ?? null)) void setThinking(level);
            }}
          >
            {model.thinkingLevels.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                closeOnClick
              >
                {thinkingLabel(model, option.id)}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value={INHERIT} closeOnClick>
              {inherit.label}
              {inherit.hint ? (
                <span className="text-muted-foreground">{inherit.hint}</span>
              ) : null}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
