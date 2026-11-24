"use client";

import { WikiIdSchema } from "@kazusa/client";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** OpenClaw agent ids stop at 64; pages may run to 128. */
const CHARACTER_MAX = 64;

/** Why `id` can't be used, or undefined when it can. */
export function idProblem(
  id: string,
  taken: ReadonlySet<string>,
  { character = false }: { character?: boolean } = {},
): string | undefined {
  if (!id) return "Enter an id.";
  if (taken.has(id)) return "Another page already uses this id.";
  if (character && id.length > CHARACTER_MAX)
    return `Keep it to ${CHARACTER_MAX} characters.`;
  if (!WikiIdSchema.safeParse(id).success)
    return "Use lowercase a–z, digits, - or _, starting with a letter or digit.";
  return undefined;
}

/**
 * The id under the name: made from it and locked until Customize, since links
 * and files use it for good. Use default goes back to the name's.
 */
export function IdField({
  inputId,
  value,
  custom,
  onCustom,
  onChange,
  problem,
}: {
  inputId: string;
  value: string;
  /** The person typed their own; otherwise it follows the name. */
  custom: boolean;
  onCustom: (custom: boolean) => void;
  onChange: (id: string) => void;
  problem: string | undefined;
}) {
  return (
    <Field data-invalid={problem ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={inputId}>Id</FieldLabel>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => onCustom(!custom)}
        >
          {custom ? "Use default" : "Customize"}
        </Button>
      </div>
      <Input
        id={inputId}
        value={value}
        disabled={!custom}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        aria-invalid={problem ? true : undefined}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
      />
      {problem ? (
        <FieldError>{problem}</FieldError>
      ) : (
        <FieldDescription>
          Links use the id. It can't be changed later.
        </FieldDescription>
      )}
    </Field>
  );
}
