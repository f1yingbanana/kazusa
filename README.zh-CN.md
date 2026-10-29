<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.png" />
    <img src=".github/assets/banner-light.png" alt="Kazusa" width="720" />
  </picture>
</p>

<p align="center">
  <b>让你的赛博老婆、老公们，在一个 24/7 实时运转的世界里活起来。</b>
</p>

<p align="center">
  <a href="https://discord.gg/wbNyB85V4X">
    <img src="https://img.shields.io/badge/Discord-%E5%8A%A0%E5%85%A5%E7%A4%BE%E5%8C%BA-5865F2?style=flat-square&logo=discord&logoColor=white" alt="加入 Discord 社区" />
  </a>
  <a href="https://x.com/f1yingbanana">
    <img src="https://img.shields.io/badge/%E5%85%B3%E6%B3%A8-%40f1yingbanana-181717?style=flat-square&logo=x&logoColor=white" alt="在 X 上关注 @f1yingbanana" />
  </a>
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#实机效果">实机效果</a> ·
  <a href="#快速上手">快速上手</a>
</p>

**KAZUSA**（**K**-**A**gent **Z**ero-drift **U**niversal **S**imulation
**A**rchitecture）是一个基于 OpenClaw、可以自行部署的 AI 世界模拟沙盒。它让你的所有角色在同一个世界里 24/7 实时生活。把角色导入或捏出来，放进世界，看他们互相聊天、约见面、奔走于不同地点之间、根据自己的需求计划事项，甚至畅想未来。你忙你的时候，他们在你创造的虚拟世界里过着他们的生活。

**直接导入 SillyTavern（酒馆）V2 角色卡（.png 或 .json）。**
人设、对话示例和世界书都能一起带过来。内置的系统管理员智能体 **ARONA**
会帮你把现有角色和设定变成一个会自行运转的世界。

**KAZUSA** 的设计参考了 AI 智能体与社会模拟领域的前沿研究，例如
[《生成式智能体：人类行为的交互式模拟》](https://arxiv.org/abs/2304.03442)、
[《Project Sid：迈向 AI 文明的多智能体模拟》](https://arxiv.org/html/2411.00114v1)
和[《用欲望驱动的自主行为模拟人类日常活动》](https://arxiv.org/abs/2412.06435)。
**KAZUSA**
希望把前沿 AI 研究变成角色扮演玩家一直想要的功能，同时控制运行成本，让养一个世界不至于烧穿钱包。

> [!NOTE]
>
> **KAZUSA**
> 目前处于**早期开发阶段**，会有 Bug，也会有不兼容更新。角色卡导入、ARONA 新手引导，以及下方的
> `setup` / `dev` 命令，描述的是首个版本的目标体验，目前还在施工中。

## 功能亮点

### 🧠 拟人化思考机制

**KAZUSA**
以接近真人的方式模拟角色的思考过程，让一些很有“人味”的行为自然出现：考前忙着复习，消息推迟回；回复打到一半收到新消息，会及时审查旧的回复是否还有发出去的必要、做出修改。

### 📚 持久记忆

角色会逐渐形成自己对世界的理解。他们会维护一份记忆 Wiki，记录人物、地点、想法和事件，事情有变化也会更新。群聊里形成的记忆，换到和另一个角色私聊时也能接得上。

### ❤️ 欲望驱动的自主行动

角色会根据当下的本能需求、约定过的事、长期目标等，规划接下来的行动。他们做了什么、时间过去了多久，都会改变各种欲望值，推动他们去做下一件事。

### 👥 真正的群聊

每个角色都是独立的智能体，会给自己的任务排优先级、判断聊天上下文，也会处理中途插入的新情况。所以群聊更像一群有自己的事要忙的人在聊天，互动也更自然。

### 🔭 行为与状态可视化

你可以随时查看每个角色在忙什么，并在时间线里看到所有角色的计划、结果和想法。他们的小剧场，随时可以围观。

### ✈️ 移动与偶遇

角色生活在你定义的空间里，会按照自己的计划和日常安排，沿着地图合理地移动。他们会自然碰面、结伴、聊天，然后一起做点什么。

### ✨ 聊天式角色与世界编辑

上传一张 **SillyTavern V2
PNG 或 JSON 角色卡**，或者描述一个原创角色，交给内置系统管理员 **ARONA**（**A**I
**R**oleplay **O**rchestration and **N**arration
**A**dministrator，AI 角色扮演编排与叙事管理员）。 **ARONA**
会帮你把人设和背景融入当前设定，搭建世界，并建立角色的记忆 Wiki。

## 实机效果

<picture>
  <img src=".github/assets/frontend-screenshot.png" alt="Kazusa 网页客户端：群聊、所选角色的活动与需求，以及世界时钟控制" />
</picture>

和角色聊天，看看他们在做什么、状态如何，再到时间线里围观对话和活动。你也可以暂停模拟，或调整时间流逝的速度。

## 快速上手

准备一个 [OpenRouter](https://openrouter.ai)
API 密钥，就能用来驱动对话、决策和记忆。你也可以手动配置不同供应商的模型，分别使用对应的 API 密钥。下面的流程，自己跑或者交给你的 AI 跑都行。

### 1. 安装

需要先安装 **Node.js 24.16+（24.x）或 26.1+**，以及 **Git**。

```bash
git clone https://github.com/f1yingbanana/kazusa.git
cd kazusa
npm ci
```

### 2. 填入 API 密钥

创建一个
[OpenRouter API 密钥](https://openrouter.ai/keys)，给账户充值，然后运行：

```bash
npm run setup
```

在安装向导的提示处粘贴你的密钥，接受默认对话模型，或选择其他**支持工具调用**的模型。安装向导会用同一个密钥，预设
**TypeSafe Jev** 作为决策模型、 **text-embedding-3-small**
作为记忆检索的向量模型，连接好前端，并初始化好 **ARONA**。

能力更强的大模型，通常更擅长维持人设和前后连贯，但也往往更贵、回复更慢。想自定义模型或供应商，可以参考
[OpenClaw 官方指南](https://docs.openclaw.ai/concepts/model-providers)。

### 3. 启动，找 **ARONA** 聊天

```bash
npm run dev
```

这会同时启动 Gateway 和网页前端。打开 **http://localhost:3000**，
在角色列表里选择 **ARONA**，点击 **Message（发消息）**。附上一张
**.png 或 .json 角色卡**，试着说：

> 帮我导入这个角色，再围绕 TA 搭一个小世界。先问问我想要什么设定，然后帮 TA 建好记忆 Wiki。

你也可以描述原创角色，让 ARONA 先写一份初稿，再自己修改角色的 `IDENTITY.md` 或
`SOUL.md` 文件。

## 一起来建设

一起搭一个你也想待着的世界吧。原创角色、小型世界观，或是一段暴露了角色反应不自然的对话，都和代码贡献一样有价值。欢迎[提个 Issue](https://github.com/f1yingbanana/kazusa/issues)，说说发生了什么、你期待什么样的表现；也可以先给仓库点个**星星**，蹲后续更新。

## 相关项目

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [Generative Agents](https://github.com/joonspk-research/generative_agents)
- [AI Town](https://github.com/a16z-infra/ai-town)
- [AIRI](https://github.com/moeru-ai/airi)
