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

Keep at your current activity for longer: estimate when you will be done.

## delay_task.minutesLeft

How many more minutes from now until you expect to finish.

## delay_task.reason

Optional reason.

## delay_task.monologue

Optional: one or two sentences of inner monologue in your voice, as plain text.

## delay_task.afterwards

As in start_task: only the desires the extended activity changes, as
current→afterwards state.

## send_message

Say something in a chat, in person or by text: its address alone says which.
Bubbles in messages, 1 to {maxBubbles}, are said one at a time. Delivery retries
automatically. Returns `delivered`, or `pending` while delivery retries; if you
were cut off, how many bubbles were `said` `of` them, what was `heard` of a line
cut short, and then what stopped you.

## send_message.sessionKey

The chat's address, e.g. chat:direct:bob or chat:huddle:k3x9p2m0qa.

## send_message.messages

Your bubbles, in order. By text, each is a short message: a few words or one
sentence. Aloud, each is a line you say: a sentence or two.

## send_message.messages.type

"speech" or "action". Default "speech".

## send_message.messages.sticker

A sticker of yourself, as a bubble of its own, to show how you feel. Most
messages need none: send one when your mood shifts, and not the same mood twice
in a row unless the feeling is strong. {data}

## send_message.messages.face

Face to face only: the face you show as you say or do this, one of your moods.
Everyone with you sees it, and it stays until you show another. Most lines need
none: set it when your expression changes, not on every line.

## send_message.sticker-outfits

A name that starts with an outfit shows you wearing it; the others show your
usual clothes. {outfits}.

## create_group

Start a text group chat with others and get its address to send_message to. It
stays quiet until you say something in it. For one person, text their direct
chat instead (chat:direct:<id>).

## create_group.members

Other agent or human IDs; you are included automatically.

## create_group.title

Optional name for the group.

## talk

Turn to people where you are, to talk with them aloud. Someone in another
conversation: you walk over to it. Some of your own: you start a side
conversation with just them. People talking with nobody: they join yours, or one
starts. Returns its address to send_message to. They must be here, and in no
more than one conversation.

## talk.members

Who you turn to: agent or human IDs of people here.

## list_chats

Find your current direct and group chats by optional title, member ID or session
key. Returns each reply address, title and members, without anyone's history.

## list_chats.query

Title, member ID or session key; omit to list all your chats.

## manage_chat

Rename a group chat, add or remove members, or leave it. Use title for rename,
members for add_members or remove_members, neither for leave. Direct chats have
fixed membership; a conversation in person can only be left, which steps back
from it without leaving the place. Changes affect only later messages; joining
grants no earlier history.

## manage_chat.sessionKey

The address of your group chat, or of your conversation in person to leave it.

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

Keep something past today: a plan or promise, someone new, or what changes how
you see someone.

## remember.about

Who or what it is about, by name or id; `me` for your own plans and promises.

## remember.note

What to remember, in one line. Today's date is added for you.

## remember.source

How you know: `seen it`, `told by <id>`, `overheard <id>`, `read it` or
`my guess`. Defaults to `seen it`.

## remember.certainty

How sure you are. Defaults to `sure`.

## remember.on

With `about: me`: the day a plan happens, YYYY-MM-DD. Defaults to today.
