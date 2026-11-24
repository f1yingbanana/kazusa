"use client";

import { UsersIcon } from "lucide-react";
import { AddPeople } from "@/components/inspector/sections/chat-controls";
import type { Chat } from "@/lib/source/chats/types";

export function HaloAlone({
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
    <aside className="halo-alone" data-slim={slim ? "" : undefined} aria-label="No one else here">
      <span className="halo-alone-seats" aria-hidden="true">
        <span />
        <span />
        <span />
        <UsersIcon className="size-4" />
      </span>
      <div className="halo-alone-copy">
        <p className="halo-alone-title">
          {inPerson ? "Nobody else is around" : "It's just you in here"}
        </p>
        <p className="halo-alone-body text-pretty">
          {canAdd
            ? inPerson
              ? "Call someone over to start talking."
              : "Messages wait until someone joins. Add people to get it going."
            : "No one else is in this chat yet."}
        </p>
      </div>
      {canAdd ? <AddPeople chat={chat} placeName={placeName} /> : null}
    </aside>
  );
}

export function HaloEmptyRoom({ slim = false }: { slim?: boolean }) {
  return (
    <aside className="halo-alone" data-slim={slim ? "" : undefined} aria-label="No one here">
      <span className="halo-alone-seats" aria-hidden="true">
        <span />
        <span />
        <span />
        <UsersIcon className="size-4" />
      </span>
      <div className="halo-alone-copy">
        <p className="halo-alone-title">The room is empty</p>
        <p className="halo-alone-body text-pretty">
          Everyone has left. Join to bring it back to life, or wait for someone to wander in.
        </p>
      </div>
    </aside>
  );
}
