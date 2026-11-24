"use client";

import { Button } from "@ui-sdk/react/button";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { Textarea } from "@ui-sdk/react/textarea";
import { useState } from "react";
import { characterById, chats as seedChats, type Chat, world } from "./data";
import { Portrait } from "./portrait";

export function ChatsTab() {
  const [chats, setChats] = useState<Chat[]>(seedChats);
  const [activeId, setActiveId] = useState(seedChats[0].id);
  const [draft, setDraft] = useState("");
  const active = chats.find((c) => c.id === activeId) ?? chats[0];

  function send() {
    const text = draft.trim();
    if (!text) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? {
              ...c,
              messages: [
                ...c.messages,
                { id: `m${Date.now()}`, from: "you", text, time: world.clock },
              ],
            }
          : c,
      ),
    );
    setDraft("");
  }

  return (
    <div className="lab-chats">
      <Listbox
        aria-label="Conversations"
        className="lab-chat-list"
        value={activeId}
        onValueChange={(value) => {
          if (typeof value === "string") {
            setActiveId(value);
            setChats((prev) => prev.map((c) => (c.id === value ? { ...c, unread: 0 } : c)));
          }
        }}
      >
        {chats.map((chat) => {
          const last = chat.messages[chat.messages.length - 1];
          const lead = characterById[chat.members.find((m) => m !== "you") ?? ""];
          return (
            <ListboxItem key={chat.id} value={chat.id} label={chat.title}>
              {lead && <Portrait character={lead} size="sm" decorative />}
              <span className="lab-chat-item-body">
                <span className="lab-chat-item-title">{chat.title}</span>
                <span className="lab-chat-item-preview">{last.text}</span>
              </span>
              <span className="lab-chat-item-meta">
                <span>{last.time}</span>
                {chat.unread > 0 && (
                  <span className="lab-unread">
                    {chat.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </span>
            </ListboxItem>
          );
        })}
      </Listbox>

      <section className="lab-thread" aria-labelledby="lab-thread-title">
        <header className="lab-thread-head">
          <div>
            <h2 id="lab-thread-title" className="lab-thread-title">
              {active.title}
            </h2>
            <p className="lab-thread-sub">
              {active.place} · {active.members.filter((m) => m !== "you").map((m) => characterById[m]?.name.split(" ")[0]).join(", ")} and you
            </p>
          </div>
          <div className="lab-thread-faces">
            {active.members
              .filter((m) => m !== "you")
              .map((m) => (
                <Portrait key={m} character={characterById[m]} size="sm" />
              ))}
          </div>
        </header>

        <ol className="lab-messages" aria-label={`Messages in ${active.title}`}>
          {active.messages.map((msg, i) => {
            const author = characterById[msg.from];
            const prev = active.messages[i - 1];
            const grouped = prev?.from === msg.from;
            return (
              <li
                key={msg.id}
                className="lab-message"
                data-mine={msg.from === "you" || undefined}
                data-grouped={grouped || undefined}
              >
                {!grouped && msg.from !== "you" && author && (
                  <span className="lab-message-author">{author.name.split(" ")[0]}</span>
                )}
                <p className="lab-bubble">{msg.text}</p>
                <time className="lab-message-time">{msg.time}</time>
              </li>
            );
          })}
        </ol>

        <form
          className="lab-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            aria-label={`Message ${active.title}`}
            placeholder={`Say something to ${active.title}…`}
            autoResize
            rows={1}
            value={draft}
            onValueChange={setDraft}
            submitShortcut="enter"
            onSubmit={send}
          />
          <Button type="submit" className="lab-send" disabled={!draft.trim()}>
            Send
          </Button>
        </form>
      </section>
    </div>
  );
}
