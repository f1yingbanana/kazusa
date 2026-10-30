import type {
  ModelOption,
  ModelProviderStatus,
  ThinkingLevel,
} from "@kazusa/client";

const PROVIDER_LABELS: Record<string, string> = {
  zai: "Z.AI",
  openrouter: "OpenRouter",
  venice: "Venice",
};

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

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function modelName(model: ModelOption) {
  return model.alias ?? model.name;
}

/** The catalog's name for a ref, else the ref itself (a model gone from it). */
export function refName(models: readonly ModelOption[], ref: string) {
  const model = models.find((option) => option.ref === ref);
  return model ? modelName(model) : ref;
}

export function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The model's own word for a level (Z.AI calls `low` "on"). */
export function thinkingLabel(
  model: ModelOption | undefined,
  level: ThinkingLevel | undefined,
) {
  if (!level) return undefined;
  return capitalize(
    model?.thinkingLevels.find((option) => option.id === level)?.label ?? level,
  );
}
