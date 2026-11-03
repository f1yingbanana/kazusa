---
name: kazusa-tools
description:
  "What each character tool and its fields say to the model. Each section is one
  tool (`## send_message`) or field (`## send_message.messages`). Override only
  the sections you change."
user-invocable: false
disable-model-invocation: true
---

`{placeholders}` are filled by code. `{data}` is what code supplies for that
field, such as the list of desires.

## start_task

Start an activity, or conclude the current one and begin the next.

## start_task.type

Category of the activity.

## start_task.description

What you are doing, in your own words.

## start_task.duration

Planned duration in minutes, at least {minDuration}.

## start_task.summary

What happened in the activity being replaced, if there was one.

## start_task.monologue

Optional: one or two sentences of inner monologue in your voice, as plain text.

## start_task.metadata

Optional activity-specific metadata.

## start_task.where

Where this activity happens: a place from Where you are (id or name), or your
own words for a spot where you are. With {data}, it is where you are going.

## start_task.afterwards

Only the desires this activity changes, each as current→afterwards state, e.g. a
night's sleep: { "energy": "low→full" }. Desires: {data}

## delay_task

Move the end of your current activity later by N minutes.

## delay_task.additionalDuration

Additional minutes.

## delay_task.reason

Optional reason.

## delay_task.monologue

Optional: one or two sentences of inner monologue in your voice, as plain text.

## delay_task.afterwards

As in start_task: only the desires the extended activity changes, as
current→afterwards state.

## send_message

Say something in a chat. Use sessionKey for an existing chat, or members and an
optional title to start one; one other member without a title is your direct
chat. Bubbles in messages, 1 to {maxBubbles}, are sent one at a time. Delivery
retries automatically.

## send_message.aloud

Speak aloud to members who are where you are, instead of texting them.

## send_message.sessionKey

Your chat address, e.g. chat:direct:bob. Omit members and title.

## send_message.members

Other agent or human IDs to start a chat with; you are included automatically.
Omit with sessionKey.

## send_message.title

Optional new group title.

## send_message.messages

Your bubbles, in order.

## send_message.messages.type

"speech" or "action". Default "speech".

## list_chats

Find your current direct and group chats by optional title, member ID or session
key. Returns each reply address, title and members, without anyone's history.

## list_chats.query

Title, member ID or session key; omit to list all your chats.

## manage_chat

Rename a group chat, add or remove members, or leave it. Use title for rename,
members for add_members or remove_members, neither for leave. Direct chats have
fixed membership. Changes affect only later messages; joining grants no earlier
history.

## manage_chat.sessionKey

Your group chat's address.

## recall

Try to remember something on the tip of your tongue: searches what you remember
and what you would know.

## recall.query

What you are trying to remember, in your own words.

## look_up

Check a public source for something you don't know. Finds only what is publicly
known.

## look_up.topic

What to look up.

## remember

Note something to remember.

## remember.about

Who or what it is about, by name or id; `me` for your own plans and promises.

## remember.note

What to remember.

## remember.source

How you know: `seen it`, `told by <id>`, `overheard <id>`, `read it` or
`my guess`. Defaults to `seen it`.

## remember.certainty

How sure you are. Defaults to `sure`.

## remember.on

With `about: me`: the day a plan happens, YYYY-MM-DD. Defaults to today.
