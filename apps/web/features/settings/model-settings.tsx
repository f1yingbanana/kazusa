"use client";

import type { EmbeddingModelOption, RoleModelOption } from "@kazusa/client";
import { FolderOpenIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useDecisionModels, useEmbeddingModels } from "@/hooks/use-model-roles";
import { useModels } from "@/hooks/use-models";
import { useProviderLabel } from "@/hooks/use-providers";
import { Button } from "@/ui/button";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { Callout, SettingsPage, SettingsSection } from "@/ui/settings";
import { ModelPicker, RolePicker, ThinkingPicker } from "./model-pickers";
import { ProviderSettings } from "./provider-settings";
import { Unavailable } from "./unavailable";

const count = new Intl.NumberFormat("en");

function ConfigFiles() {
  const { isLocal } = useAccess();
  if (!isLocal) return null;

  async function reveal() {
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
  }

  return (
    <SettingsSection
      title="OpenClaw settings file"
      description="Edit advanced Gateway and model options by hand."
      action={
        <Button
          tone="soft"
          size="sm"
          icon={<FolderOpenIcon aria-hidden />}
          onClick={() => void reveal()}
        >
          Show file
        </Button>
      }
    />
  );
}

function RoleField({
  title,
  description,
  options,
  current,
  loading,
  error,
  onSelect,
  note,
}: {
  title: string;
  description: string;
  options: readonly RoleModelOption[];
  current: string | undefined;
  loading: boolean;
  error?: Error;
  onSelect: (ref: string) => void;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-bold text-ui-ink">{title}</span>
        <span className="text-xs leading-normal text-ui-soft">
          {description}
        </span>
      </div>
      {error && loading ? (
        <Callout tone="danger">{error.message}</Callout>
      ) : null}
      <RolePicker
        title={title}
        options={options}
        current={current}
        loading={loading && !error}
        onSelect={onSelect}
        className="max-w-md"
      />
      {note}
    </div>
  );
}

function DecisionSettings() {
  const { data, error, select } = useDecisionModels();
  const providerLabel = useProviderLabel();
  const options = data?.options ?? [];
  const current = options.find((option) => option.ref === data?.current);
  const missing =
    current && !current.available
      ? `Add a ${providerLabel(current.provider)} key under Providers to use this.`
      : undefined;

  return (
    <RoleField
      title="Decision model"
      description="Quick judge that decides whether a character should reply. Without one, characters react to everything (slower and higher token cost)."
      options={options}
      current={data?.current}
      loading={!data}
      error={error}
      onSelect={(ref) => void select(ref)}
      note={
        missing ? <p className="text-xs text-ui-danger">{missing}</p> : null
      }
    />
  );
}

function MemorySearchSettings() {
  const { data, error, select } = useEmbeddingModels();
  const providerLabel = useProviderLabel();
  const [pending, setPending] = useState<EmbeddingModelOption>();
  const options = data?.options ?? [];
  const current = options.find((option) => option.ref === data?.current);

  const choose = (ref: string) => {
    const next = options.find((option) => option.ref === ref);
    if (!next) return;
    if (current && next.vectors !== current.vectors) setPending(next);
    else void select(next.ref);
  };

  const progress = data?.progress;
  const status = !current
    ? undefined
    : !current.available
      ? `Add a ${providerLabel(current.provider)} key under Providers to use this.`
      : progress && progress.embedded < progress.total
        ? `Indexing ${count.format(progress.embedded)} of ${count.format(progress.total)} passages.`
        : undefined;

  return (
    <>
      <RoleField
        title="Memory search model"
        description="Finds memories by meaning instead of exact keywords alone."
        options={options}
        current={data?.current}
        loading={!data}
        error={error}
        onSelect={choose}
        note={status ? <p className="text-xs text-ui-soft">{status}</p> : null}
      />

      <AlertDialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <AlertPanel
          title={pending ? `Switch to ${pending.name}?` : "Switch model?"}
          description="Memories are indexed again in the background. Until that finishes, characters recall by keywords. Switching back is instant."
          agentConfirm={
            pending
              ? `Switches memory search to ${pending.name} and re-indexes passages`
              : "Switches memory search model"
          }
          onConfirm={() => {
            if (pending) void select(pending.ref);
            setPending(undefined);
          }}
        />
      </AlertDialog>
    </>
  );
}

export function ModelSettings() {
  const { enabled, data, error } = useModels();
  const current = data?.models.find((model) => model.ref === data.current);

  return (
    <SettingsPage
      title="Models"
      description="Choose the AI models that power your characters and connect provider API keys."
    >
      {!enabled ? (
        <>
          <Unavailable
            requires={["models"]}
            title="Model settings need a live Gateway"
          />
          <ConfigFiles />
        </>
      ) : (
        <>
          <SettingsSection
            title="Chat model"
            description="Powers character speech, actions, and thoughts. You can override this per character in their details."
          >
            {error && !data ? (
              <Callout tone="danger">{error.message}</Callout>
            ) : null}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-ui-ink">Model</span>
                <ModelPicker label="Chat model" className="max-w-md" />
              </div>
              {current && current.thinkingLevels.length >= 2 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-bold text-ui-ink">
                    Reasoning
                  </span>
                  <ThinkingPicker label="Reasoning" className="max-w-md" />
                </div>
              ) : null}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Background models"
            description="Optional helper models that reduce unnecessary replies and improve memory recall."
          >
            <div className="flex flex-col gap-5">
              <DecisionSettings />
              <MemorySearchSettings />
            </div>
          </SettingsSection>

          <ProviderSettings />

          <ConfigFiles />
        </>
      )}
    </SettingsPage>
  );
}
