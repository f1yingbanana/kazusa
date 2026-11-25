"use client";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export { idProblem } from "@/lib/wiki/page-id";

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
