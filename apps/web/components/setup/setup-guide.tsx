"use client";

import { format } from "date-fns";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { Spinner } from "@/components/ui/spinner";
import type { SetupStatus, WorldOption } from "@/lib/setup/setup";

const SLOW_START_MS = 180_000;
/**
 * How long to wait for a welcome once the Gateway answers: a world may have
 * none.
 */
const WELCOME_WAIT_MS = 5_000;
const START_POLL_MS = 1_000;

function GroupTag({
  name,
  ids,
  cast,
  onToggle,
}: {
  name: string;
  ids: readonly string[];
  cast: ReadonlySet<string>;
  onToggle: (ids: readonly string[], on: boolean) => void;
}) {
  const on = ids.every((id) => cast.has(id));
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "default" : "outline"}
      onClick={() => onToggle(ids, !on)}
    >
      {`${name} · ${ids.length}`}
    </Button>
  );
}

/** Picks who is simulated. Everyone else stays available to bring on later. */
function CastPicker({
  world,
  cast,
  onChange,
}: {
  world: WorldOption;
  cast: ReadonlySet<string>;
  onChange: (cast: ReadonlySet<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(cast);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-36 flex-col gap-2 overflow-y-auto">
        <div className="flex flex-wrap gap-1.5">
          <GroupTag
            name="All"
            ids={world.characters.map(({ id }) => id)}
            cast={cast}
            onToggle={toggle}
          />
        </div>
        {world.groups.map(({ field, groups }) => (
          <div key={field} className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground capitalize">{field}</p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map(({ name, ids }) => (
                <GroupTag
                  key={name}
                  name={name}
                  ids={ids}
                  cast={cast}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Input
        aria-label="Search characters"
        placeholder={`Search ${world.characters.length} characters`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid max-h-64 grid-cols-1 gap-x-3 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
        {world.characters
          .filter(
            ({ id, name }) =>
              !needle || `${id} ${name}`.toLowerCase().includes(needle),
          )
          .map(({ id, name }) => (
            <label
              key={id}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={cast.has(id)}
                onCheckedChange={(on) => toggle([id], Boolean(on))}
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{`${cast.size} onstage`}</p>
    </div>
  );
}

function StartTimePicker({
  date,
  time,
  onDate,
  onTime,
}: {
  date: Date;
  time: string;
  onDate: (date: Date) => void;
  onTime: (time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <FieldGroup className="flex-row">
      <Field>
        <FieldLabel htmlFor="setup-start-date">Date</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                id="setup-start-date"
                type="button"
                variant="outline"
                className="justify-between font-normal"
              />
            }
          >
            {format(date, "PPP")}
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              captionLayout="dropdown"
              required
              onSelect={(picked) => {
                onDate(picked);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </Field>
      <Field className="w-32">
        <FieldLabel htmlFor="setup-start-time">Time</FieldLabel>
        <Input
          id="setup-start-time"
          type="time"
          value={time}
          onChange={(event) => onTime(event.target.value)}
          className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden"
        />
      </Field>
    </FieldGroup>
  );
}

/**
 * Starting with no key is allowed: the world is there to look at, and any
 * provider can be connected from Settings later. What doesn't work until then
 * is said plainly.
 */
function NoKeyWarning() {
  return (
    <Alert>
      <TriangleAlertIcon />
      <AlertTitle>Characters can&apos;t think yet</AlertTitle>
      <AlertDescription>
        <p>
          Until a provider has a key, nobody can reply or act, the admin
          included. You&apos;ll land in Settings, under Models: paste a key for
          OpenRouter or any other provider there, and its models are ready at
          once.
        </p>
        <p>
          An OpenRouter key also covers decisions and memory search. With
          another provider, characters react to everything (slower, and it costs
          more) and remember by keywords only.
        </p>
      </AlertDescription>
    </Alert>
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
  useEffect(() => {
    const started = Date.now();
    let answeredAt: number | undefined;
    const timer = setInterval(async () => {
      if (Date.now() - started > SLOW_START_MS) setSlow(true);
      const response = await fetch("/kazusa/chats").catch(() => null);
      if (!response?.ok) return;
      if (keyless) {
        window.location.assign("/?view=settings&settings.tab=models");
        return;
      }
      answeredAt ??= Date.now();
      const { chats } = (await response.json()) as {
        chats: readonly {
          id: string;
          type: string;
          members: readonly string[];
        }[];
      };
      const chat = chats.find(
        ({ type, members }) =>
          type === "direct" && members.includes(systemAgent),
      );
      if (chat)
        window.location.assign(
          `/?view=chats&chats.id=${encodeURIComponent(chat.id)}`,
        );
      else if (Date.now() - answeredAt > WELCOME_WAIT_MS)
        window.location.assign(
          `/?view=chats&chats.dm=${encodeURIComponent(systemAgent)}`,
        );
    }, START_POLL_MS);
    return () => clearInterval(timer);
  }, [keyless, systemAgent]);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Spinner className="size-6" />
      <p className="font-medium">Starting your world</p>
      <p className="text-sm text-muted-foreground">
        {slow
          ? "This is taking longer than it should. Check Kazusa's terminal window."
          : paused
            ? "Time starts paused, so nothing is spent until you press play."
            : "This takes a few seconds."}
      </p>
    </div>
  );
}

/**
 * The first thing a new player sees. It only ever asks what's still missing, so
 * reloading or restarting partway is harmless (`lib/setup/setup.ts`).
 */
export function SetupGuide({ status }: { status: SetupStatus }) {
  const [worldId, setWorldId] = useState(status.imported);
  const [cast, setCast] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => new Date());
  const [date, setDate] = useState(now);
  const [time, setTime] = useState(() => format(now, "HH:mm"));
  const [key, setKey] = useState("");
  const [skipKey, setSkipKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);

  const world = status.worlds.find(({ id }) => id === worldId);
  const pickingCast = Boolean(world?.characters.length);
  const [activeItem, setActiveItem] = useState(
    !status.imported ? "world" : pickingCast ? "cast" : "keys",
  );
  const items = useMemo(
    () => [
      ...(status.imported
        ? []
        : [
            {
              name: "world",
              required: true,
              choices: status.worlds.map(({ id }) => ({ value: id })),
            },
          ]),
      ...(pickingCast ? [{ name: "cast" }, { name: "time" }] : []),
      { name: "keys" },
    ],
    [status.imported, status.worlds, pickingCast],
  );

  const chooseWorld = (option: WorldOption) => {
    setWorldId(option.id);
    setCast(new Set(option.defaultCast));
  };

  // Only the world step has choices the questionnaire knows about, and it won't
  // pass an item without one, so this guide moves between the steps itself.
  const goNext = (event: React.MouseEvent) => {
    event.preventDefault();
    const next = items[items.findIndex(({ name }) => name === activeItem) + 1];
    if (next) setActiveItem(next.name);
  };

  const submit = async () => {
    if (!world || submitting) return;
    if (!status.hasKey && !skipKey && !key.trim()) {
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
        ...(pickingCast
          ? { startAt: `${format(date, "yyyy-MM-dd")}T${time}` }
          : {}),
        ...(key.trim() && !skipKey ? { openrouterKey: key.trim() } : {}),
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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {starting && world ? (
          <Starting
            paused={pickingCast}
            systemAgent={world.systemAgent}
            keyless={!status.hasKey && skipKey}
          />
        ) : (
          <>
            <h1 className="text-xl font-semibold">Welcome to Kazusa</h1>
            <Questionnaire
              items={items}
              item={activeItem}
              onItemChange={setActiveItem}
              onSubmit={(event) => event.preventDefault()}
            >
              <QuestionnaireProgress />

              {status.imported ? null : (
                <QuestionnaireItem name="world" required>
                  <QuestionnaireTitle>
                    Which world do you want?
                  </QuestionnaireTitle>
                  <QuestionnaireDescription>
                    This copies a world for you to play in. You can change
                    anything in it later.
                  </QuestionnaireDescription>
                  <QuestionnaireChoices>
                    {status.worlds.map((option) => (
                      <QuestionnaireChoice
                        key={option.id}
                        value={option.id}
                        checked={worldId === option.id}
                        onChange={() => chooseWorld(option)}
                      >
                        <span className="font-medium">{option.title}</span>
                        <QuestionnaireChoiceDescription>
                          {option.description}
                        </QuestionnaireChoiceDescription>
                      </QuestionnaireChoice>
                    ))}
                  </QuestionnaireChoices>
                </QuestionnaireItem>
              )}

              {world && pickingCast ? (
                <QuestionnaireItem name="cast">
                  <QuestionnaireTitle>Who is onstage?</QuestionnaireTitle>
                  <QuestionnaireDescription>
                    Each character onstage thinks and acts on their own, which
                    costs tokens. Start small: you can bring anyone on or off
                    later.
                  </QuestionnaireDescription>
                  <CastPicker world={world} cast={cast} onChange={setCast} />
                </QuestionnaireItem>
              ) : null}

              {pickingCast ? (
                <QuestionnaireItem name="time">
                  <QuestionnaireTitle>
                    When does the story begin?
                  </QuestionnaireTitle>
                  <QuestionnaireDescription>
                    The in-world date and time on the first day. Time starts
                    paused until you press play.
                  </QuestionnaireDescription>
                  <StartTimePicker
                    date={date}
                    time={time}
                    onDate={setDate}
                    onTime={setTime}
                  />
                </QuestionnaireItem>
              ) : null}

              <QuestionnaireItem name="keys">
                <QuestionnaireTitle>
                  {status.hasKey
                    ? "Your OpenRouter key is saved"
                    : "Connect a model provider"}
                </QuestionnaireTitle>
                <QuestionnaireDescription>
                  {status.hasKey
                    ? "You are ready to start."
                    : "Characters need a model to think. One OpenRouter key covers chat, decisions and memory search, and it's kept with OpenClaw's saved sign-ins on this computer."}
                </QuestionnaireDescription>
                {status.hasKey ? null : (
                  <div className="flex flex-col gap-3">
                    {skipKey ? null : (
                      <Field data-invalid={Boolean(error)}>
                        <FieldLabel htmlFor="setup-openrouter-key">
                          OpenRouter API key
                        </FieldLabel>
                        <Input
                          id="setup-openrouter-key"
                          type="password"
                          autoComplete="off"
                          placeholder="sk-or-…"
                          value={key}
                          onChange={(event) => setKey(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void submit();
                          }}
                          aria-invalid={Boolean(error)}
                        />
                        <FieldDescription>
                          <a
                            className="underline"
                            href="https://openrouter.ai/keys"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Create a key
                          </a>{" "}
                          and add credits to your account.
                        </FieldDescription>
                      </Field>
                    )}
                    <Button
                      type="button"
                      variant="link"
                      className="w-fit px-0"
                      onClick={() => {
                        setSkipKey(!skipKey);
                        setError(null);
                      }}
                    >
                      {skipKey
                        ? "Add an OpenRouter key instead"
                        : "Skip for now, or use another provider"}
                    </Button>
                    {skipKey ? <NoKeyWarning /> : null}
                  </div>
                )}
                {error ? <FieldError>{error}</FieldError> : null}
              </QuestionnaireItem>

              <QuestionnaireActions>
                <QuestionnairePrevious />
                <QuestionnaireNext disabled={!world} onClick={goNext} />
                <QuestionnaireSubmit
                  disabled={submitting}
                  onClick={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  {submitting ? "Starting…" : "Start"}
                </QuestionnaireSubmit>
              </QuestionnaireActions>
            </Questionnaire>
          </>
        )}
      </div>
    </main>
  );
}
