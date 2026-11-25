"use client";

import { UsersIcon } from "lucide-react";
import { AddPeople } from "@/components/inspector/sections/chat-controls";
import type { Chat } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";

/** Three empty seats where faces would be. */
function Seats({ slim }: { slim: boolean }) {
  const seat = cn(
    "rounded-full border-2 border-dashed border-primary/50 bg-background motion-safe:animate-[chat-seat_2.8s_ease-in-out_infinite]",
    slim ? "size-7" : "size-9",
  );
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center"
    >
      <span className={seat} />
      <span className={cn(seat, "-ms-2.5 [animation-delay:0.3s]")} />
      <span className={cn(seat, "-ms-2.5 [animation-delay:0.6s]")} />
      <UsersIcon
        className={cn(
          "absolute inset-s-1/2 -translate-x-1/2 text-primary",
          slim ? "size-3.5" : "size-4",
        )}
      />
    </span>
  );
}

function Notice({
  label,
  title,
  body,
  slim,
  children,
}: {
  label: string;
  title: string;
  body: string;
  slim: boolean;
  children?: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className={cn(
        "flex items-center gap-3",
        slim
          ? "mx-auto mb-2 w-full px-4 py-3 text-start"
          : "m-auto max-w-88 flex-col px-5 py-6 text-center",
      )}
    >
      <Seats slim={slim} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[0.9375rem] font-extrabold">{title}</p>
        <p className="text-[0.8125rem] leading-normal text-pretty text-muted-foreground">
          {body}
        </p>
      </div>
      {children}
    </aside>
  );
}

/** Nobody else in a group or in-person chat the player is in. */
export function ChatAlone({
  chat,
  canAdd,
  placeName,
  slim = false,
}: {
  chat: Chat;
  canAdd: boolean;
  placeName?: string;
  slim?: boolean;
}) {
  const inPerson = chat.type === "huddle";
  return (
    <Notice
      label="No one else here"
      slim={slim}
      title={inPerson ? "Nobody else is around" : "It's just you in here"}
      body={
        canAdd
          ? inPerson
            ? "Call someone over to start talking."
            : "Messages wait until someone joins. Add people to get it going."
          : "No one else is in this chat yet."
      }
    >
      {canAdd ? <AddPeople chat={chat} placeName={placeName} /> : null}
    </Notice>
  );
}

/** An observed room everyone has left. */
export function ChatEmptyRoom({ slim = false }: { slim?: boolean }) {
  return (
    <Notice
      label="No one here"
      slim={slim}
      title="The room is empty"
      body="Everyone has left. Join to bring it back to life, or wait for someone to wander in."
    />
  );
}
