<div align="center">

# 纯粹CC · ChunCui CC

**Claude Code 多会话驾驶舱 — 一块屏幕掌舵你所有的 Claude Code 项目**
**A mission-control cockpit for Claude Code — steer all your sessions from one screen**

`实时仪表盘` · `真终端并行` · `红绿灯状态` · `4 层记忆` · `工程文档` · `Token / 剩余额度` · `Mac 客户端`

<sub>made with ◢◤ by <b>存粹</b></sub>

</div>

---

## ✨ 这是什么 / What is it

你用 Claude Code 在很多项目里干活，时间一长就忘了「哪个需求是在哪个项目下提的、做到哪一步了」。

**纯粹CC** 实时扫描你本机的 `~/.claude`，把散落各处的东西聚成一块**科幻 HUD 驾驶舱**：看得到每个项目的需求、进度、记忆、技能、文档、Token 用量；还能**在多个真终端窗口里并行驱动 Claude Code**，每个窗口用**红绿灯**告诉你它在干活、在等你确认、还是已经空闲。

> You run Claude Code across many repos and lose track of *which task lives where and how far it got*. **纯粹CC** scans your local `~/.claude` in real time and turns it into a sci-fi HUD: requirements, progress, memory, skills, docs and token usage per project — plus **multiple real terminal windows** driving Claude Code in parallel, each with a **traffic light** (busy / waiting-for-you / idle).

## 🚀 功能 / Features

| | 中文 | English |
|---|---|---|
| 🛰 | **项目总览** — 扫描 `~/.claude/projects`，还原每个项目真实路径，按最近活跃排序 | Live scan of all local projects |
| 📋 | **需求** — 每个会话的首条消息就是你当时提的需求 | First user message = the requirement |
| 📊 | **进度可下钻** — 合并 TodoWrite 任务 + superpowers `specs/` 复选框，环形进度 + 明细 | Progress from tasks **and** `specs/*.md` checkboxes |
| 🧠 | **4 层记忆** — `user / feedback / project / reference` 分组展示 | The 4 memory layers, grouped |
| 🛠 | **技能** — 项目本地 `.claude/skills` + 全局技能，含描述 | Project-local + global skills |
| 📄 | **工程文档** — `specs/ docs/ plans/` 里的 Markdown，浮窗内直接阅读 | Read project docs in a floating window |
| 🔢 | **Token & 剩余额度** — 每会话/每项目/全局用量 + 近 30 天柱状图 + 实时读取 `/usage` 真实剩余百分比 | Token usage + real remaining quota scraped from `/usage` |
| 🖥 | **真终端并行** — 每个会话一个真正的交互式 `claude`（PTY + xterm），可拖动/缩放/最小化/独立窗口 | Real interactive `claude` per session |
| 🚦 | **红绿灯状态** — 🔴进行中 / 🟡等你确认 / 🟢空闲，最小化也看得到 | Traffic-light session status |
| 🍎 | **Mac 客户端** — Electron 原生窗口，会话可脱离主窗口、拖到任意显示器 | Native macOS desktop app |

## 📦 安装与运行 / Install & Run

需要 **Node.js ≥ 18** 和已安装的 **`claude` CLI**。

```bash
git clone https://github.com/dengmingrui/helm-cc.git
cd helm-cc
npm install            # node-pty (原生) + ws + electron
```

**A. 浏览器模式 / Browser**
```bash
npm start              # = node server.js
# 打开 http://localhost:4317
```

**B. Mac 客户端 / Desktop app**
```bash
npm run app            # 原生窗口，会话弹独立窗口
```

换端口：`PORT=8080 npm start` ｜ 指定 claude：`CLAUDE_BIN=/opt/homebrew/bin/claude npm start`

> ⚠️ 本工具会启动**真实的** Claude Code 子进程在你的项目目录下执行操作，**请自行启动并知悉**。
> This launches **real** Claude Code processes that act in your repos — start it yourself, knowingly.

## 🚦 状态 Hooks（可选 / Opt-in）

红绿灯默认靠终端输出**启发式推断**就能用。想要**权威精准**的状态（尤其「等你确认」🟡 和「完成」🟢），可以装一组 Claude Code hooks：

```bash
npm run hooks          # = node add-hooks.js  （会先备份 settings.json）
node add-hooks.js --remove   # 撤销
```

- **绝不自动安装**，永远是你显式运行；会先备份 `~/.claude/settings.json`。
- 没装也能用（启发式兜底）。
- Hook 只是把事件 `curl` 给本地仪表盘，静默、1 秒超时、永远 exit 0，仪表盘没开就瞬间失败、无副作用。

> The traffic light works out of the box via a PTY heuristic. For **authoritative** status, install the hooks (opt-in, backed up, reversible). They just POST events to the local dashboard; silent, 1s-timeout, always exit 0.

## 🏗 架构 / Architecture

```
┌─────────────────────────────────────────────┐
│  纯粹CC 仪表盘 (public/ · 原生 HTML/CSS/JS)     │
│  ├─ 实时扫描 ~/.claude → /api/data            │
│  └─ 点「对话」→ 开一个真终端会话                  │
└───────────────┬─────────────────────────────┘
        WebSocket │  /api/term
┌───────────────▼─────────────────────────────┐
│  server.js (Node 内置 http + ws + node-pty)   │
│  └─ PTY 里跑真实交互式 `claude`               │
└───────────────┬─────────────────────────────┘
        settings hooks │ POST /api/hook (session_id, event)
                       ▼  → 路由到对应终端 → 红绿灯
```

- **server.js** — Node 内置 `http` + `ws` + `node-pty`，实时扫描磁盘、跑 PTY 终端、接收 hook 事件。
- **public/** — 纯原生 HTML/CSS/JS（零框架），xterm.js 本地 vendored（离线可用）。
- **electron/** — 桌面外壳：用系统 node 跑 server（避开 node-pty 的 Electron ABI 问题），会话以原生窗口呈现。

## 🍎 打包成 App / Build a `.app`

```bash
npm run dist           # electron-builder → dist/纯粹CC.dmg
```

## 🔧 技术备注 / Notes

- **node-pty 与新版 Node**：若终端报 `posix_spawnp failed`，从源码重编一次：
  `cd node_modules/node-pty && npx node-gyp rebuild`（需 Xcode CLT + python3）。
- **xterm 本地化**：`public/vendor/` 已内置 xterm / addon-fit / marked，不依赖 CDN、可离线。
- **会话连续性**：终端用 `--session-id`（新）/ `--resume`（接续），会话自动落盘到 `~/.claude`，又出现在仪表盘里，形成闭环。

## 📁 目录 / Layout

```
server.js          实时数据 + PTY 终端 + hook 接收
add-hooks.js       一键装/卸状态 hooks（带备份）
electron/          桌面客户端 (main.js · preload.js)
public/            仪表盘 + 终端页 + 文档页 + vendor 库
```

## 📝 License & Author

MIT · made by **存粹** · 2026
