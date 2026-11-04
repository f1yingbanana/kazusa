<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.png" />
    <img src=".github/assets/banner-light.png" alt="Kazusa" width="720" />
  </picture>
</p>

<p align="center">
  <b>
    Bring your waifus and husbandos alive in a real-time, 24/7 living world.
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

**KAZUSA** is an AI world simulator based on OpenClaw. **KAZUSA** gives your
characters purpose, needs, goals, and memories. Watch them chat with each other,
plan their next meetup, travel between locations, manage their priorities, and
dream about their future. Put all your favorite characters in a room and see how
they interact with each other, and with you.

**Import your character cards.** Bring their personalities, example dialogue,
and lorebooks with you and add them to your world. **ARONA**, the built-in
system admin agent, helps turn your existing data into a living world.

**Or ask for an entire world.** Describe anything, and **ARONA** will research
it and set up your personal living world: characters, relationships, locations,
lore, secrets, anything in one prompt.

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

The built-in system admin AI, **ARONA**, helps you edit your existing characters
or build them from scratch. Simply describe an idea, a world you want to create,
or how you want to change the existing world, and **ARONA** will deliver those
changes.

## Screenshots

Group chat and the character state inspector:

<picture>
  <img src=".github/assets/chats-screenshot.png"/>
</picture>

World timeline showing character actions, and location details:

<picture>
  <img src=".github/assets/timeline-screenshot.png"/>
</picture>

## Getting started

> [!NOTE]
>
> For people that are interested but do not wish to set this up themselves,
> consider [waitlisting here](https://openrp.ai/kazusa). We'll send an email
> once we get this running as a one-click deploy service in the cloud.

**Download the Windows or Mac installer from
[Releases](https://github.com/f1yingbanana/kazusa/releases/latest)**, or install
with npm below.

You'll need **Node.js 24+** and **Git**. Simply open a terminal and run (or ask
your AI to do this for you):

```bash
git clone https://github.com/f1yingbanana/kazusa.git && cd kazusa && npm run dev
```

It installs everything and opens a guide at **http://localhost:3000** that asks
for:

1. **A world**: choose from a sample world, or an empty one for you to build
   with.
2. **Who is on-stage and when the story begins**, for the sample worlds, pick
   which characters are actively simulated when the world starts.
3. **A model provider key**. One
   [OpenRouter API key](https://openrouter.ai/keys) powers conversation,
   decisions and memory search. You can also skip to set up separate providers
   in settings later.

Your world lives in `apps/kazusa/world/`. To start afresh, stop Kazusa with
Ctrl + C and delete that folder. Run `npm run dev` again to reinitialize.

To update, open **Settings > Updates**. Kazusa downloads the latest release and restarts, keeping your world data unchanged.

### Talk to **ARONA**

**ARONA** is the built in system admin agent that will help you build your
world.

You can describe original characters and ask ARONA to create a draft, then hand
edit their IDENTITY.md or SOUL.md files on disk (located under
world/workspaces/[character-id]/).

You can also ask **ARONA** to create an entire world from scratch. For example,
to create the world of **Touhou Project**:

```
Create the world of Touhou Project. Examine the level of detail in the world
examples in apps/kazusa/worlds/: the settings, characters, locations, and memory
wikis. We need to recreate the same level of detail. Search online for your
source of information. Report your progress at each stage.
```

Depending on the complexity of the world you want to create, the research and
creation process may run autonomously up to an hour or two. At the end you will
get a fully working world with characters, locations and memories initialized.

> [!NOTE]
>
> To view **ARONA**'s progress, click on the **Brain** icon on her character
> details sidebar to read her thought process.

As a safety precaution characters are off-stage when first created. You can ask
**ARONA** to move these characters on-stage or do it yourself in the World Tab.

> [!NOTE]
>
> You may also do this with **Claude Code** or another coding agent. The skills
> it needs come with the repository. This may be faster as coding agents are
> generally faster than OpenClaw at research and writing.

## Build with us

Help shape a world you would want to spend time in. Original character examples,
small settings, and scenes that expose an unnatural reaction are as useful as
code. [Open an issue](https://github.com/f1yingbanana/kazusa/issues) with what
happened and what you expected.

Please star **star the repository** to follow development and
[join our Discord](https://discord.gg/wbNyB85V4X) for discussions.

## Related projects

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [Generative Agents](https://github.com/joonspk-research/generative_agents)
- [AI Town](https://github.com/a16z-infra/ai-town)
- [AIRI](https://github.com/moeru-ai/airi)
