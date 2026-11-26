"use client";

import {
  ActivityIcon,
  CircleAlertIcon,
  CircleArrowUpIcon,
  CircleXIcon,
  EyeIcon,
  MenuIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SquarePlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCharacter } from "@/hooks/use-characters";
import { useSaves } from "@/hooks/use-saves";
import { useSelection } from "@/hooks/use-selection";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import { openSavesDialog } from "@/lib/state/ui-store";
import { Fold, Folds } from "@/ui/fold";
import { Button, buttonClass, TextButton } from "@/ui/button";
import { Dialog, DialogClose, DialogPanel } from "@/ui/dialog";
import { Drawer, DrawerPanel, DrawerTrigger } from "@/ui/drawer";
import { ListRow, ListRows } from "@/ui/list";
import { CharacterAvatar } from "../characters/character-avatar";
import { useOpenSettings } from "../settings/search-params";
import { WorldValuesFold } from "../stats/world-values";
import { useInstall } from "./install";
import { SocialLinks } from "./social-links";
import { ActivityList, useActivity } from "./status/activity";
import { CONNECTION, ConnectionDot } from "./status/connection";
import { FailureList, useFailures } from "./status/failures";
import { useProblems } from "./status/problems";
import { useKazusaUpdate } from "./status/update";
import { STATUS_LINK } from "./status/look";
import { useYouAre } from "./status/you-are";
import { useStatusAccess } from "./status-bar";

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center text-ui-soft [&_svg]:size-4.5">
      {children}
    </span>
  );
}

/**
 * Everything a phone has no room for, as a sheet: who you are and where, who's
 * busy, what needs looking at, then search, saves, settings and the community.
 * The status bar's signals live here, since a phone has no bar.
 */
export function MoreMenu({
  onOpenCommand,
  onOpenDetails,
}: {
  onOpenCommand: () => void;
  onOpenDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { resolved } = useSources();
  const show = useStatusAccess();
  const you = useYouAre();
  const activity = useActivity();
  const { failing } = useFailures();
  const problems = useProblems();
  const update = useKazusaUpdate();
  const saves = useSaves();
  const openSettings = useOpenSettings();
  const status = useRealtimeStore((state) => state.status);
  const install = useInstall();
  const [iosSteps, setIosSteps] = useState(false);
  const attention =
    (show.failures && failing.length > 0) ||
    (show.update && Boolean(update.version)) ||
    status === "error";
  const then = (act: () => void) => () => {
    setOpen(false);
    act();
  };

  return (
    <>
      <IosInstallSteps open={iosSteps} onOpenChange={setIosSteps} />
      <Drawer open={open} onOpenChange={setOpen} side="bottom">
        <DrawerTrigger
          aria-label={attention ? "Menu, something needs a look" : "Menu"}
          className="relative grid size-10 place-items-center rounded-full text-ui-soft hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:bg-ui-tint [&_svg]:size-5"
        >
          <MenuIcon aria-hidden />
          {attention ? (
            <span
              aria-hidden
              className="absolute top-2 right-2 size-2 rounded-full bg-ui-danger ring-2 ring-ui-ground"
            />
          ) : null}
        </DrawerTrigger>
        <DrawerPanel title="Menu" handle="Close" fit>
          <div className="flex flex-col gap-1 overflow-y-auto px-3 pt-2 pb-1">
            {you.shown ? (
              <YouRow
                onDone={() => setOpen(false)}
                onOpenDetails={onOpenDetails}
              />
            ) : null}

            <div className="px-1">
              <Folds>
                {show.activity ? (
                  <Fold
                    value="busy"
                    title="Who's busy"
                    summary={activity.summary}
                    icon={<ActivityIcon />}
                  >
                    <ActivityList onPicked={() => setOpen(false)} />
                  </Fold>
                ) : null}
                {show.failures && failing.length > 0 ? (
                  <Fold
                    value="failed"
                    title="Failed turns"
                    summary={`${failing.length} failed`}
                    icon={<CircleAlertIcon className="text-ui-danger" />}
                  >
                    <div className="flex flex-col gap-2">
                      <FailureList onPicked={() => setOpen(false)} />
                    </div>
                  </Fold>
                ) : null}
                {satisfies(resolved, ["stats"]) ? <WorldValuesFold /> : null}
              </Folds>
            </div>

            <div className="border-t border-ui-line pt-2">
              <ListRows>
                {show.update && update.version ? (
                  <li>
                    <ListRow
                      leading={
                        <Icon>
                          <CircleArrowUpIcon aria-hidden />
                        </Icon>
                      }
                      title={`Update to ${update.version}`}
                      onClick={then(update.open)}
                    />
                  </li>
                ) : null}
                {show.problems && problems.errors + problems.warnings > 0 ? (
                  <li>
                    <ListRow
                      leading={
                        <Icon>
                          {problems.errors ? (
                            <CircleXIcon aria-hidden />
                          ) : (
                            <TriangleAlertIcon aria-hidden />
                          )}
                        </Icon>
                      }
                      title="Problems in the wiki"
                      sub={[
                        problems.errors ? `${problems.errors} errors` : null,
                        problems.warnings
                          ? `${problems.warnings} warnings`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      onClick={then(problems.open)}
                    />
                  </li>
                ) : null}
                <li>
                  <ListRow
                    leading={
                      <Icon>
                        <SearchIcon aria-hidden />
                      </Icon>
                    }
                    title="Search"
                    onClick={then(onOpenCommand)}
                  />
                </li>
                {saves.enabled ? (
                  <li>
                    <ListRow
                      leading={
                        <Icon>
                          <SaveIcon aria-hidden />
                        </Icon>
                      }
                      title="Save or load"
                      onClick={then(() => {
                        openSavesDialog();
                        void saves.refresh();
                      })}
                    />
                  </li>
                ) : null}
                <li>
                  <ListRow
                    leading={
                      <Icon>
                        <SettingsIcon aria-hidden />
                      </Icon>
                    }
                    title="Settings"
                    onClick={then(() => openSettings())}
                  />
                </li>
                {install.way === "prompt" || install.way === "ios" ? (
                  <li>
                    <ListRow
                      leading={
                        <Icon>
                          <SquarePlusIcon aria-hidden />
                        </Icon>
                      }
                      title="Add to home screen"
                      onClick={then(() =>
                        install.way === "prompt"
                          ? void install.install()
                          : setIosSteps(true),
                      )}
                    />
                  </li>
                ) : null}
              </ListRows>
            </div>

            <div className="mt-1 flex items-center justify-between gap-3 border-t border-ui-line px-2 pt-3 text-xs text-ui-soft">
              <span className="inline-flex items-center gap-1.5">
                <ConnectionDot status={status} />
                {CONNECTION[status].label}
              </span>
              <SocialLinks />
            </div>
          </div>
        </DrawerPanel>
      </Drawer>
    </>
  );
}

/** Safari has no install prompt: say where its Add to Home Screen is. */
function IosInstallSteps({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel
        title="Add Kazusa to your home screen"
        description="It opens full screen, like an app, straight into your world."
        footer={
          <DialogClose className={buttonClass({ tone: "primary" })}>
            Got it
          </DialogClose>
        }
      >
        <ol className="ms-5 flex list-decimal flex-col gap-2 text-sm leading-relaxed">
          <li>
            Tap Share{" "}
            <ShareIcon
              aria-label="(the square with an arrow)"
              className="inline size-4 align-[-0.15em] text-ui-primary"
            />{" "}
            in Safari&apos;s toolbar.
          </li>
          <li>Choose Add to Home Screen, then Add.</li>
        </ol>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * Who you are and where: your face and name open your details (or, watching,
 * who you could play); the place is a link of its own, drawn as one.
 */
function YouRow({
  onDone,
  onOpenDetails,
}: {
  onDone: () => void;
  onOpenDetails: () => void;
}) {
  const you = useYouAre();
  const me = useCharacter(you.id);
  const [, select] = useSelection();
  const then = (act: () => void) => () => {
    onDone();
    act();
  };
  const openSelf = you.watching
    ? (you.switchWho ?? onOpenDetails)
    : onOpenDetails;
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <TextButton
        aria-label={you.watching ? you.switchLabel : "Your details"}
        className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
        onClick={then(openSelf)}
      >
        {me ? (
          <CharacterAvatar
            id={me.id}
            name={me.name}
            avatarUrl={me.avatarUrl}
            kind={me.kind}
            size="md"
            decorative
          />
        ) : (
          <span className="grid size-10 place-items-center rounded-full bg-ui-tint text-ui-soft [&_svg]:size-5">
            <EyeIcon aria-hidden />
          </span>
        )}
      </TextButton>
      <div className="flex min-w-0 flex-1 flex-col">
        <TextButton
          className="truncate rounded-[0.375rem] text-start text-[0.9375rem] font-bold focus-visible:outline-2 focus-visible:outline-ui-primary"
          onClick={then(openSelf)}
        >
          {you.watching ? (
            "You're watching"
          ) : (
            <>
              You are <span className="text-ui-primary">{you.name}</span>
            </>
          )}
        </TextButton>
        <span className="flex min-w-0 items-center gap-1 text-[0.8125rem] text-ui-soft">
          {you.watching ? (
            "Nobody here can see you."
          ) : you.place ? (
            <>
              at
              <TextButton
                className={`${STATUS_LINK} min-w-0`}
                onClick={then(
                  () => void select({ kind: "place", id: you.place?.id ?? "" }),
                )}
              >
                <span className="truncate">{you.place.name}</span>
              </TextButton>
            </>
          ) : (
            "Somewhere in the world"
          )}
        </span>
      </div>
      {!you.watching && you.switchWho ? (
        <Button tone="ghost" size="sm" onClick={then(you.switchWho)}>
          Switch
        </Button>
      ) : null}
    </div>
  );
}
