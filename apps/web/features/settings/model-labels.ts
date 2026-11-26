import type {
  ModelOption,
  ModelProviderStatus,
  ThinkingLevel,
} from "@kazusa/client";
import { KazusaApiError } from "@/lib/source/http";

export const UNAVAILABLE_LABELS: Record<
  NonNullable<ModelOption["unavailableReason"]>,
  string
> = {
  "missing-auth": "No key",
  "auth-failed": "Key rejected",
  cooldown: "Cooling down",
};

export const PROVIDER_STATUS_LABELS: Record<
  ModelProviderStatus["status"],
  string
> = {
  ready: "Ready",
  "auth-rejected": "Key rejected",
  unavailable: "Unavailable",
};

export function modelName(model: ModelOption): string {
  return model.alias ?? model.name;
}

export function refName(models: readonly ModelOption[], ref: string): string {
  const model = models.find((option) => option.ref === ref);
  return model ? modelName(model) : ref;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function thinkingLabel(
  model: ModelOption | undefined,
  level: ThinkingLevel | undefined,
): string | undefined {
  if (!level) return undefined;
  return capitalize(
    model?.thinkingLevels.find((option) => option.id === level)?.label ?? level,
  );
}

export function failureText(failure: unknown): string {
  if (failure instanceof KazusaApiError) {
    return failure.message.replace(/^Request failed \(\d+\): /, "");
  }
  return failure instanceof Error ? failure.message : String(failure);
}
