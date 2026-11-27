"use client";

import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useSetupDownload } from "@/hooks/use-setup-download";
import type { SetupStatus, WorldOption } from "@/lib/setup/setup";
import { chatsKey } from "@/lib/source/chats/cache";
import { fetchChats } from "@/lib/source/chats/http";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { PasswordField } from "@/ui/field";
import { ProviderLogo } from "@/ui/provider-logo";
import { RadioList, RadioOption } from "@/ui/radio-list";
import { Callout } from "@/ui/settings";
import { CastPicker } from "./cast-picker";
import { DownloadProgress } from "./download-progress";
import { OBSERVER, PlayAsPicker } from "./play-as-picker";
import { SetupFrame } from "./setup-frame";

const SLOW_START_MS = 180_000;
/**
 * How long to wait for a welcome once the Gateway answers: a world may have
 * none.
 */
const WELCOME_WAIT_MS = 5_000;
const START_POLL_MS = 1_000;

type StepId = "world" | "cast" | "play" | "keys";

interface StepMeta {
  readonly id: StepId;
  readonly short: string;
}

/**
 * Starting with no key is allowed: the world is there to look at, and any
 * provider can be connected from Settings later. What doesn't work until then
 * is said plainly.
 */
function NoKeyWarning() {
  return (
    <Callout
      tone="info"
      icon={<TriangleAlertIcon />}
      title="Characters can't think yet"
    >
      <div className="flex flex-col gap-2">
        <p>
          Until a provider has a key, nobody can reply or act, the admin
          included. You&apos;ll land in Settings, under Models: paste a key for
          any provider there, and its models are ready at once.
        </p>
        <p>
          Decisions and memory search use whichever of your providers offers
          them, such as OpenRP or OpenRouter. Without one, characters react to
          everything (slower, and it costs more) and remember by keywords only.
        </p>
      </div>
    </Callout>
  );
}

/**
 * Lands in the system agent's chat. The welcome opens that chat as the Gateway
 * starts, so wait for it: a chat opened first would be an empty draft beside
 * it. Without a key nobody could answer there, so it lands where keys go.
 */
function Starting({
  paused,
  systemAgent,
  keyless,
}: {
  paused: boolean;
  systemAgent: string;
  keyless: boolean;
}) {
  const [slow, setSlow] = useState(false);
  const { data } = useSWR(chatsKey(), fetchChats, {
    refreshInterval: START_POLL_MS,
    errorRetryInterval: START_POLL_MS,
    dedupingInterval: START_POLL_MS,
    revalidateOnFocus: false,
  });
  const answered = Boolean(data);
  const chatId = data?.chats.find(
    ({ type, members }) => type === "direct" && members.includes(systemAgent),
  )?.id;

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!answered) return;
    if (keyless) {
      window.location.assign("/?view=settings&settings.tab=models");
      return;
    }
    if (chatId) {
      window.location.assign(
        `/?view=chats&chats.id=${encodeURIComponent(chatId)}`,
      );
      return;
    }
    const timer = window.setTimeout(() => {
      window.location.assign(
        `/?view=chats&chats.dm=${encodeURIComponent(systemAgent)}`,
      );
    }, WELCOME_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [answered, chatId, keyless, systemAgent]);

  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center gap-4 py-8 text-center motion-safe:animate-ui-enter"
    >
      <LoaderCircleIcon
        aria-hidden
        className="size-7 text-ui-primary motion-safe:animate-ui-spin"
      />
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-base font-extrabold tracking-[-0.01em] text-ui-ink">
          Starting your world
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-pretty text-ui-soft">
          {slow
            ? "This is taking longer than it should. Check Kazusa's terminal window."
            : paused
              ? "Time starts paused, so nothing is spent until you press play."
              : "This takes a few seconds."}
        </p>
      </div>
    </div>
  );
}

/**
 * The first thing a new player sees. It only ever asks what's still missing, so
 * reloading or restarting partway is harmless (`lib/setup/setup.ts`).
 */
export function SetupGuide({ status }: { status: SetupStatus }) {
  const [worldId, setWorldId] = useState<string | null>(null);
  const [cast, setCast] = useState<ReadonlySet<string>>(new Set());
  const [playAs, setPlayAs] = useState(OBSERVER);
  // Offered in `models.providers` order (`apps/kazusa/base.json`).
  const [providerId, setProviderId] = useState(status.providers[0]?.id ?? "");
  const provider = status.providers.find(({ id }) => id === providerId);
  const [key, setKey] = useState("");
  const [skipKey, setSkipKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);

  // A world is downloaded when picked, which fills in its cast.
  const [worlds, setWorlds] = useState(status.worlds);
  const [downloading, setDownloading] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [worldError, setWorldError] = useState<string | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  const downloadProgress = useSetupDownload(downloading);
  const world = worlds.find(({ id }) => id === worldId);
  const switchingTo = worlds.find(({ id }) => id === pendingSwitch);
  const pickingCast = Boolean(world?.characters.length);

  const steps = useMemo<readonly StepMeta[]>(
    () => [
      { id: "world", short: "World" },
      ...(pickingCast
        ? ([
            { id: "cast", short: "Characters" },
            { id: "play", short: "Play as" },
          ] as const)
        : []),
      { id: "keys", short: "Model" },
    ],
    [pickingCast],
  );

  useEffect(() => () => downloadAbort.current?.abort(), []);

  const [activeStep, setActiveStep] = useState<StepId>("world");
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === activeStep),
  );
  const stepsRef = useRef<HTMLElement>(null);
  const prevStepIndex = useRef(stepIndex);
  const direction =
    stepIndex > prevStepIndex.current
      ? "forward"
      : stepIndex < prevStepIndex.current
        ? "back"
        : "none";
  useEffect(() => {
    if (direction !== "none") {
      const reduce = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      stepsRef.current
        ?.querySelector<HTMLElement>('[aria-current="step"]')
        ?.scrollIntoView({
          block: "nearest",
          inline: "center",
          behavior: reduce ? "auto" : "smooth",
        });
    }
    prevStepIndex.current = stepIndex;
  }, [direction, stepIndex]);

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const canAdvance = Boolean(world?.downloaded) && !downloading;

  const startWorld = async (option: WorldOption) => {
    setWorldId(option.id);
    setCast(new Set(option.defaultCast));
    setPlayAs(option.defaultUserCharacter ?? OBSERVER);
    setWorldError(null);
    if (option.downloaded) return;
    downloadAbort.current?.abort();
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(true);
    const response = await fetch("/setup/world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: option.id }),
      signal: controller.signal,
    }).catch(() => null);
    if (downloadAbort.current === controller) {
      downloadAbort.current = null;
      setDownloading(false);
    }
    if (controller.signal.aborted) return;
    const body = (await response?.json().catch(() => null)) as
      (WorldOption & { error?: undefined }) | { error: string } | null;
    if (response?.ok && body && !body.error) {
      const downloaded = body as WorldOption;
      setWorlds((current) =>
        current.map((entry) =>
          entry.id === downloaded.id
            ? downloaded
            : entry.bundled || entry.id === "starter"
              ? entry
              : {
                  ...entry,
                  downloaded: false,
                  characters: [],
                  groups: [],
                  defaultCast: [],
                },
        ),
      );
      setCast(new Set(downloaded.defaultCast));
      setPlayAs(downloaded.defaultUserCharacter ?? OBSERVER);
    } else
      setWorldError(
        body?.error ?? `Couldn't download ${option.title}. Check the terminal.`,
      );
  };

  const chooseWorld = (id: string) => {
    const option = worlds.find((entry) => entry.id === id);
    if (!option || id === worldId) return;
    if (downloading) {
      setPendingSwitch(id);
      return;
    }
    void startWorld(option);
  };

  const confirmSwitch = async () => {
    const nextId = pendingSwitch;
    setPendingSwitch(null);
    const option = nextId ? worlds.find((entry) => entry.id === nextId) : null;
    if (!option) return;
    downloadAbort.current?.abort();
    downloadAbort.current = null;
    setDownloading(false);
    await fetch("/setup/world", { method: "DELETE" }).catch(() => null);
    await startWorld(option);
  };

  const goTo = (id: StepId) => {
    setError(null);
    setActiveStep(id);
  };

  const goBack = () => {
    const prev = steps[stepIndex - 1];
    if (prev) goTo(prev.id);
  };

  const goNext = () => {
    if (!canAdvance) return;
    const next = steps[stepIndex + 1];
    if (next) goTo(next.id);
  };

  const submit = async () => {
    if (!world || submitting) return;
    const typed = provider && !skipKey ? key.trim() : "";
    if (!status.savedKey && !skipKey && !typed) {
      setError("Paste a key, or skip this for now.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const response = await fetch("/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        world: world.id,
        cast: [...cast],
        ...(pickingCast && playAs !== OBSERVER ? { play: playAs } : {}),
        ...(provider && typed
          ? { key: { provider: provider.id, value: typed } }
          : {}),
      }),
    }).catch(() => null);
    setSubmitting(false);
    if (response?.ok) setStarting(true);
    else
      setError(
        (
          (await response?.json().catch(() => null)) as {
            error?: string;
          } | null
        )?.error ?? "Setup failed. Check the terminal.",
      );
  };

  const stepMotion =
    direction === "forward"
      ? "motion-safe:animate-ui-step-forward"
      : direction === "back"
        ? "motion-safe:animate-ui-step-back"
        : "";

  return (
    <SetupFrame
      uniform={!starting}
      headerEnd={
        !starting ? (
          <nav
            ref={stepsRef}
            aria-label="Setup steps"
            className="-m-1 flex min-w-0 scrollbar-none items-center gap-1.5 overflow-x-auto p-1 text-xs font-bold [&::-webkit-scrollbar]:hidden"
          >
            {steps.map((step, index) => {
              const current = index === stepIndex;
              const done = index < stepIndex;
              const reachable = done && !downloading && !submitting;
              return (
                <Button
                  key={step.id}
                  size="sm"
                  tone={current ? "primary" : done ? "soft" : "ghost"}
                  disabled={!reachable && !current}
                  aria-current={current ? "step" : undefined}
                  onClick={() => {
                    if (reachable) goTo(step.id);
                  }}
                  className={cx(
                    "h-7 px-2.5 text-xs",
                    !current && !done && "opacity-50",
                  )}
                >
                  {done ? (
                    <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
                  ) : null}
                  {step.short}
                </Button>
              );
            })}
          </nav>
        ) : undefined
      }
    >
      {starting && world ? (
        <Starting
          paused={pickingCast}
          systemAgent={world.systemAgent}
          keyless={!status.savedKey && skipKey}
        />
      ) : (
        <>
          <div
            key={activeStep}
            className={cx(
              "flex min-h-0 flex-1 flex-col gap-3 sm:gap-4",
              stepMotion,
            )}
          >
            {activeStep === "world" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 overflow-y-auto">
                <div className="flex shrink-0 flex-col gap-1">
                  <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
                    Which world do you want?
                  </h1>
                  <p className="text-sm leading-relaxed text-pretty text-ui-soft">
                    This downloads a world for you to play in. You can change
                    anything in it later.
                  </p>
                </div>
                <RadioList
                  label="World"
                  value={worldId}
                  onValueChange={(id) => chooseWorld(id)}
                >
                  {worlds.map((option) => (
                    <RadioOption
                      key={option.id}
                      value={option.id}
                      label={option.title}
                      hint={option.description}
                      disabled={submitting}
                      trailing={
                        option.downloaded ? (
                          <span className="rounded-full bg-ui-accent-tint px-2 py-0.5 text-[0.6875rem] font-bold text-ui-accent-ink">
                            Ready
                          </span>
                        ) : undefined
                      }
                    >
                      {downloading && worldId === option.id ? (
                        <DownloadProgress
                          title={option.title}
                          download={downloadProgress}
                        />
                      ) : null}
                    </RadioOption>
                  ))}
                </RadioList>
                {worldError ? (
                  <Callout tone="danger" title="Download failed">
                    {worldError}
                  </Callout>
                ) : null}
                <AlertDialog
                  open={Boolean(switchingTo)}
                  onOpenChange={(open) => {
                    if (!open) setPendingSwitch(null);
                  }}
                >
                  <AlertPanel
                    title="Switch world?"
                    description={
                      world && switchingTo
                        ? `Downloading ${world.title} will stop, and we'll switch to ${switchingTo.title}.`
                        : "Current download will stop."
                    }
                    onConfirm={() => void confirmSwitch()}
                  />
                </AlertDialog>
              </div>
            ) : null}

            {activeStep === "cast" && world && pickingCast ? (
              <>
                <div className="flex shrink-0 flex-col gap-1">
                  <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
                    Who starts active?
                  </h1>
                  <p className="text-sm leading-relaxed text-pretty text-ui-soft">
                    Active characters live and talk on their own. Pick a group
                    or a few favorites to begin. You can add or pause anyone
                    later.
                  </p>
                </div>
                <CastPicker world={world} cast={cast} onChange={setCast} />
              </>
            ) : null}

            {activeStep === "play" && world && pickingCast ? (
              <>
                <div className="flex shrink-0 flex-col gap-1">
                  <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
                    Who do you play?
                  </h1>
                  <p className="text-sm leading-relaxed text-pretty text-ui-soft">
                    You talk and act as them. You can switch to anyone at any
                    time.
                  </p>
                </div>
                <PlayAsPicker
                  world={world}
                  value={playAs}
                  onChange={setPlayAs}
                />
              </>
            ) : null}

            {activeStep === "keys" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 overflow-y-auto">
                <div className="flex shrink-0 flex-col gap-1">
                  <h1 className="text-xl font-extrabold tracking-[-0.015em] text-ui-ink">
                    {status.savedKey
                      ? `Your ${status.savedKey.label} key is saved`
                      : "Connect a model provider"}
                  </h1>
                  <p className="text-sm leading-relaxed text-pretty text-ui-soft">
                    {status.savedKey
                      ? "You are ready to start."
                      : "Characters need a model to think. Your key is kept with OpenClaw's saved sign-ins on this computer."}
                  </p>
                </div>
                {status.savedKey ? (
                  <Callout tone="info" title="Key ready">
                    {`Using your saved ${status.savedKey.label} key.`}
                  </Callout>
                ) : (
                  <div className="flex flex-col gap-3">
                    {skipKey || !provider ? null : (
                      <>
                        <RadioList
                          label="Model provider"
                          value={providerId}
                          onValueChange={(next) => {
                            setProviderId(next);
                            setError(null);
                          }}
                        >
                          {status.providers.map((option) => (
                            <RadioOption
                              key={option.id}
                              value={option.id}
                              label={option.label}
                              leading={
                                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ui-surface text-ui-ink inset-ring inset-ring-ui-line">
                                  <ProviderLogo
                                    provider={option.id}
                                    className="size-4"
                                  />
                                </span>
                              }
                            />
                          ))}
                        </RadioList>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                          }}
                        >
                          <PasswordField
                            label={`${provider.label} API key`}
                            placeholder="Paste your key"
                            value={key}
                            error={error ?? undefined}
                            onValueChange={(next) => {
                              setKey(next);
                              setError(null);
                            }}
                            description={
                              provider.keysUrl ? (
                                <a
                                  className="font-semibold text-ui-primary underline underline-offset-2"
                                  href={provider.keysUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Get your {provider.label} key
                                </a>
                              ) : undefined
                            }
                          />
                        </form>
                      </>
                    )}
                    {skipKey ? <NoKeyWarning /> : null}
                    {skipKey && error ? (
                      <Callout tone="danger">{error}</Callout>
                    ) : null}
                    <div className={skipKey ? undefined : "pt-1"}>
                      <Button
                        tone="link"
                        onClick={() => {
                          setSkipKey(!skipKey);
                          setError(null);
                        }}
                      >
                        {skipKey
                          ? "Add a key instead"
                          : "Skip for now, or use another provider"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ui-line py-3 sm:pt-4 sm:pb-0">
            <div>
              {!isFirst ? (
                <Button tone="ghost" disabled={submitting} onClick={goBack}>
                  Previous
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {activeStep === "cast" && pickingCast ? (
                <span className="text-xs font-semibold text-ui-soft tabular-nums">
                  {`${cast.size} active`}
                </span>
              ) : null}
              {!isLast ? (
                <Button
                  tone="primary"
                  disabled={!canAdvance}
                  pending={downloading}
                  onClick={goNext}
                >
                  Next
                </Button>
              ) : (
                <Button
                  tone="primary"
                  disabled={!canAdvance}
                  pending={submitting}
                  onClick={() => void submit()}
                >
                  Start
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </SetupFrame>
  );
}
