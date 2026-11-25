"use client";

import type { ChatMessage } from "@kazusa/client";
import {
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  ShareIcon,
} from "lucide-react";
import { domToBlob } from "modern-screenshot";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { exportScale } from "@/lib/source/chats/screenshot";
import type { ChatInfo } from "@/lib/source/chats/types";
import { Button } from "@/ui/button";
import { Dialog, DialogPanel } from "@/ui/dialog";
import { CARD_WIDTH_PX, ScreenshotCard } from "./card";

type Picture =
  | { state: "drawing" }
  | { state: "ready"; blob: Blob; url: string; file: File }
  | { state: "failed"; reason: string };

/** Every picture in the card loaded (or given up on), and the fonts too. */
async function settled(node: HTMLElement) {
  await document.fonts.ready;
  await Promise.all(
    Array.from(node.querySelectorAll("img"), (img) =>
      img.decode().catch(() => {}),
    ),
  );
}

function fileName(title: string, timestamp: number) {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "chat"}-${day}.png`;
}

/**
 * Makes the picture of the chosen messages and offers it: copy or save on a
 * computer, share where the system has a share sheet (phones). The card is laid
 * out off screen, drawn once, and shown here as the image itself, so what you
 * see is exactly the file you get.
 */
export function ScreenshotDialog({
  open,
  onOpenChange,
  onDone,
  chat,
  messages,
  userId,
  resolve,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picture went somewhere: the selection has done its job. */
  onDone: () => void;
  chat: ChatInfo;
  messages: readonly ChatMessage[];
  userId: string;
  resolve: (
    id: string,
    fallbackName?: string,
  ) => { name: string; avatarUrl?: string };
}) {
  const card = useRef<HTMLDivElement>(null);
  // Drawn once per opening: a message arriving meanwhile mustn't redraw (and
  // throw away) the picture about to be copied.
  const latest = useRef(messages);
  latest.current = messages;
  const [picture, setPicture] = useState<Picture>({ state: "drawing" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    setPicture({ state: "drawing" });
    (async () => {
      const node = card.current;
      if (!node) return;
      await settled(node);
      const scale = exportScale(CARD_WIDTH_PX, node.offsetHeight);
      if (!scale) {
        throw new Error(
          "That's too many messages for one image. Select fewer and try again.",
        );
      }
      const blob = await domToBlob(node, {
        scale,
        type: "image/png",
        backgroundColor: getComputedStyle(node).backgroundColor,
      });
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      const name = fileName(
        chat.name,
        latest.current[0]?.timestamp ?? Date.now(),
      );
      setPicture({
        state: "ready",
        blob,
        url,
        file: new File([blob], name, { type: "image/png" }),
      });
    })().catch((error: unknown) => {
      if (!cancelled)
        setPicture({
          state: "failed",
          reason:
            error instanceof Error
              ? error.message
              : "The image couldn't be made.",
        });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, chat.name]);

  const ready = picture.state === "ready" ? picture : undefined;
  const canShare =
    ready !== undefined &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [ready.file] });

  const copy = async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": ready.blob }),
      ]);
      toast.success("Image copied");
      onDone();
    } catch {
      toast.error(
        "Couldn't copy: the browser blocked the clipboard. Save it instead.",
      );
    }
  };
  const save = () => {
    if (!ready) return;
    const link = document.createElement("a");
    link.href = ready.url;
    link.download = ready.file.name;
    link.click();
    toast.success("Image saved");
    onDone();
  };
  const share = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready.file] });
      onDone();
    } catch (error) {
      // Closing the share sheet isn't a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't share the image. Save it instead.");
    }
  };

  const count = messages.length;

  return (
    <>
      {open
        ? createPortal(
            // Laid out where nobody sees it; the picture is taken of it.
            <div
              aria-hidden
              className="pointer-events-none fixed top-0 -left-2500"
            >
              <ScreenshotCard
                ref={card}
                chat={chat}
                messages={messages}
                userId={userId}
                resolve={resolve}
              />
            </div>,
            document.body,
          )
        : null}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPanel
          title="Screenshot"
          description={`${count} ${count === 1 ? "message" : "messages"}`}
          size="sm"
          full
          footer={
            <>
              <Button
                disabled={!ready}
                icon={<DownloadIcon aria-hidden />}
                onClick={save}
              >
                Save image
              </Button>
              {canShare ? (
                <Button
                  tone="primary"
                  disabled={!ready}
                  icon={<ShareIcon aria-hidden />}
                  onClick={() => void share()}
                >
                  Share
                </Button>
              ) : (
                <Button
                  tone="primary"
                  disabled={!ready}
                  icon={<CopyIcon aria-hidden />}
                  onClick={() => void copy()}
                >
                  Copy image
                </Button>
              )}
            </>
          }
        >
          <div className="flex min-h-48 flex-1 justify-center overflow-y-auto rounded-[1rem] bg-ui-tint p-3">
            {ready ? (
              <img
                src={ready.url}
                alt={`Screenshot of ${count} ${count === 1 ? "message" : "messages"}`}
                className="h-fit w-full max-w-80 rounded-[0.75rem] shadow-ui motion-safe:animate-ui-enter max-sm:max-w-full"
              />
            ) : picture.state === "failed" ? (
              <p className="flex items-center gap-2 self-center text-sm text-ui-danger">
                <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
                {picture.reason}
              </p>
            ) : (
              <LoaderCircleIcon
                role="img"
                aria-label="Making the image"
                className="size-6 self-center text-ui-soft motion-safe:animate-ui-spin"
              />
            )}
          </div>
        </DialogPanel>
      </Dialog>
    </>
  );
}
