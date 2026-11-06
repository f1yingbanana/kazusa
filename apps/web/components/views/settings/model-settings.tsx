"use client";

import { FolderOpenIcon } from "lucide-react";
import { toast } from "sonner";
import { Unavailable } from "@/components/entities/source-state";
import { ModelPicker } from "@/components/models/model-picker";
import { ThinkingPicker } from "@/components/models/thinking-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useModels } from "@/hooks/use-models";
import { ProviderSettings } from "./provider-settings";
import { DecisionSettings, MemorySearchSettings } from "./role-settings";
import { SettingsSection } from "./settings-section";

/** Shows a world file in Finder or Explorer; `/reveal` is local-owner only. */
function ConfigFiles() {
  const reveal = async () => {
    const response = await fetch("/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "config" }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as {
      path?: string;
      error?: string;
    } | null;
    if (!result?.path) {
      toast.error("Couldn't open that file", { description: result?.error });
      return;
    }
    toast.success("Opened the folder", { description: result.path });
  };

  return (
    <SettingsSection
      title="Advanced"
      description="Change anything by hand in OpenClaw's settings file."
    >
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => void reveal()}
      >
        <FolderOpenIcon />
        Show settings file
      </Button>
    </SettingsSection>
  );
}

/**
 * The world's three model slots, then the providers whose keys run them. Each
 * says what it does in a line; nothing more.
 */
export function ModelSettings() {
  const { enabled, data, error } = useModels();

  if (!enabled) {
    // A broken config is often why the Gateway is down, so the files stay in reach.
    return (
      <div className="flex flex-col">
        <Unavailable
          requires={["models"]}
          title="Model settings need a live Gateway"
        />
        <ConfigFiles />
      </div>
    );
  }

  const current = data?.models.find((model) => model.ref === data.current);

  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Chat model"
        description="Large Language Model responsible for character speech, action and thoughts."
      >
        {error && !data ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="world-model">Model</FieldLabel>
            <ModelPicker id="world-model" className="max-w-md" />
          </Field>
          {current && current.thinkingLevels.length >= 2 ? (
            <Field>
              <FieldLabel htmlFor="world-thinking">Reasoning</FieldLabel>
              <ThinkingPicker id="world-thinking" className="max-w-md" />
            </Field>
          ) : null}
        </FieldGroup>
      </SettingsSection>

      <DecisionSettings />

      <MemorySearchSettings />

      <ProviderSettings />

      <ConfigFiles />
    </div>
  );
}
