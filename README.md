<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.png" />
    <img src=".github/assets/banner-light.png" alt="Kazusa" width="720" />
  </picture>
</p>

<p align="center">
  <b>
    Bring your waifus and husbandos (multiple) alive in a real-time, 24/7 living
    world.
  </b>
</p>

<p align="center">
  <a href="https://discord.gg/wbNyB85V4X">
    <img src="https://img.shields.io/discord/1129193845809233941?logo=discord&logoColor=white&label=Discord&color=5865F2" alt="Join our Discord community" />
  </a>
  <a href="https://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=IBHnmOPB4a0508LQlxoHxHoyZhXjrwWL&authKey=gT763Bb4wyQxkwRoTBQKotA1K8jNasJFooko%2BN528WLeuMqyR2fOlBUYqi0IgXGR&noverify=0&group_code=338067231"><img src="https://img.shields.io/badge/QQ-%2312B7F5?logo=qq&labelColor=FFFFFF"></a>
  <a href="https://x.com/f1yingbanana">
    <img src="https://img.shields.io/twitter/follow/f1yingbanana" alt="Follow @f1yingbanana on X" />
  </a>
</p>

<p align="center">
  <strong>English</strong> · 
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#getting-started">Getting started</a>
</p>

**KAZUSA** is an AI world simulator based on OpenClaw. Import or create your
characters, and **KAZUSA** gives them purpose, needs, goals, and memories. Watch
them chat with each other, plan their next meetup, travel between locations,
manage their priorities, and dream about their future. Put all your favorite
waifus in a room and see how they interact with each other, and with you.

**Import your SillyTavern V2 character cards (.png or .json).** Bring their
personalities, example dialogue, and lorebooks with you. **ARONA**, the built-in
system admin agent, helps turn your existing data into a living world.

**KAZUSA** is built based on leading AI research papers on AI agents and society
simulation, such as
[Generative Agents: Interactive Simulacra of Human Behavior ](https://arxiv.org/abs/2304.03442),
[Project Sid: Many-agent simulations toward AI civilization](https://arxiv.org/html/2411.00114v1)
and
[Simulating Human-like Daily Activities with Desire-driven Autonomy](https://arxiv.org/abs/2412.06435).
**KAZUSA** aims to make large-scale society simulation accessible for everyone,
because your character isn't really alive unless placed in a world they belong
to.

> [!WARNING]
>
> **KAZUSA** is currently in **early development**. Expect bugs and breaking
> changes.

## Features

### 📚 Persistent memory wiki

Characters don't just remember things, they build a mental model of the world
they are in. Every action they perform, place they visit, or interaction with
you updates their impression of the world and leave a lasting mark on their
evolving personality.

### 🧠 Human brain modeling

Characters are driven by AI that closely mirrors how the human brain functions.
They focus on one task at a time, prioritize important tasks over minor
interruptions, and pivot based on context. Complex behavior such as group chats
and conversation pivoting come for free.

### ❤️ Desire-driven actions

Characters plan out their next actions based on current human desires, promises
they've made and long term goals. Actions and the natural flow of time changes
the desire levels to push characters to do realistic and believable things.

### 🔭 Observability

You have complete visibility of what each character is doing. View events on a
timeline showing plans, outcomes and thoughts for all the characters.

### ✈️ Travel and encounters

Characters exist in physical space you define, and move logically across the map
based on their plans and routines. They run into each other naturally, form
groups, converse, and do things together.

### ✨ Agent-based editor

Upload a **SillyTavern V2 PNG or JSON character card** or describe an original
character to the built-in system admin AI, **ARONA**. **ARONA** helps adapt
their personality and lore to your setting, build the world, and set up their
memory wiki.

## See it in action

<picture>
  <img src=".github/assets/chats-screenshot.png" alt="Kazusa's web client showing a group conversation, the selected character's activity and needs, and world clock controls" />
</picture>

<picture>
  <img src=".github/assets/timeline-screenshot.png" alt="Kazusa's web client showing a timeline on all character activities" />
</picture>
Chat with characters, inspect what they're doing and how they feel, and follow
conversations and activities in the Timeline. Pause or change simulation speed.

## Getting started

> [!NOTE]
>
> For people that are interested but do not wish to set this up themselves,
> consider [waitlisting here](https://openrp.ai/kazusa). We'll send an email
> once we get this running as a one-click deploy service in the cloud.

You will need an [OpenRouter](https://openrouter.ai) key to power conversation,
decisions, and memory. Alternatively, you can set up models from different
providers with different API keys manually. You or your coding agent can follow
this setup flow.

### 1. Install

You'll need **Node.js 24.16+ (24.x) or 26.1+** and **Git**.

```bash
git clone https://github.com/f1yingbanana/kazusa.git
cd kazusa
npm ci
```

### 2. Enter your API key

Create an [OpenRouter API key](https://openrouter.ai/keys), add credits to your
account, then run:

```bash
npm run setup
```

Paste your key into the setup prompt and accept the default conversational
model, or choose another **tool-capable** model. Setup preconfigures **TypeSafe
Jev** for decisions and **text-embedding-3-small** for memory search using that
same key, connects the frontend, and prepares **ARONA**.

Larger, more capable models can improve characterization and consistency, but
usually cost more and respond more slowly. To customize models or providers,
follow the
[official OpenClaw guide](https://docs.openclaw.ai/concepts/model-providers).

> [!NOTE]
>
> Theoretically, you can skip Jev and embedding models. However, not using Jev
> will greatly reduce the speed of processing simultaneous events, and not using
> embedding models will greatly reduce the accuracy of memory and context
> retrieval.

### 3. Launch and talk to **ARONA**

```bash
npm run dev
```

This starts the Gateway and frontend together. Open **http://localhost:3000**,
select **ARONA** in the character roster, and click **Message**. Attach a **.png
or .json character card** and try:

> Import this character and help me build a small world around them. Ask me
> about the setting, then set up their memory wiki.

You can also describe original characters and ask ARONA to create a draft, then
hand edit their IDENTITY.md or SOUL.md files.

## Build with us

Help shape a world you would want to spend time in. Original character examples,
small settings, and scenes that expose an unnatural reaction are as useful as
code. [Open an issue](https://github.com/f1yingbanana/kazusa/issues) with what
happened and what you expected, or **star the repository** to follow
development.

## Related projects

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [Generative Agents](https://github.com/joonspk-research/generative_agents)
- [AI Town](https://github.com/a16z-infra/ai-town)
- [AIRI](https://github.com/moeru-ai/airi)
