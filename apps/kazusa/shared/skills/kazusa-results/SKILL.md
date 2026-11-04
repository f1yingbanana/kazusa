---
name: kazusa-results
description:
  "What a character is told when a tool call is refused, and what an activity
  change says (its record and its result). Each section is one result. Override
  only the sections you change."
user-invocable: false
disable-model-invocation: true
---

Facts only: what to do about them is the other skills' to say. `{placeholders}`
are filled by code. `{until}` is a sim time; `{notes}` is what Location adds
(where it happens, the way there), each starting with a space.

## already-said

You already said that, and they have it.

## lookup-limit

That's all you can find right now.

## second-activity

You chose your activity moments ago, so this did not run. You can change it in a
couple of minutes.

## out-of-time

You are out of time for this reaction, so this did not run. You can still speak.

## hard-limit

This reaction is over, so this did not run.

## aloud-on-the-way

You're on your way, so nobody is close enough to hear.

## aloud-not-here

{who} isn't here, so they can't hear you.

## aloud-not-there

You aren't there, so nobody in it can hear you.

## outside-repository

{path} is outside the Kazusa repository, so this did not run.

## secret-file

{path} holds secrets, so this did not run.

## task-started

Started {type}: "{description}".{notes} Until {until} ({minutes} min).

## task-finished

Finished {type}. {started}

## task-finished-summary

Finished {type}: "{summary}". {started}

## task-delayed

Delayed {minutes} min, until {until}.{notes}

## task-delayed-reason

Delayed {minutes} min, until {until}. Reason: {reason}{notes}
