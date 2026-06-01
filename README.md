<div align="center">

**中文** · [English](./README.en.md)

# 纯粹CC

**Claude Code 多会话驾驶舱 — 一块屏幕掌舵你所有的 Claude Code 项目**

`实时仪表盘` · `真终端并行` · `红绿灯状态` · `4 层记忆` · `工程文档` · `Token / 剩余额度` · `Mac 客户端`

<sub>made with ◢◤ by <b>存粹</b></sub>

<br><br>

<img src="docs/screenshot-dashboard.png" alt="纯粹CC · Claude Code 驾驶舱" width="900" />

</div>

---

## ✨ 这是什么

你用 Claude Code 在很多项目里干活，时间一长就忘了「哪个需求是在哪个项目下提的、做到哪一步了」。

**纯粹CC** 实时扫描你本机的 `~/.claude`，把散落各处的东西聚成一块**科幻 HUD 驾驶舱**：看得到每个项目的需求、进度、记忆、技能、文档、Token 用量；还能**在多个真终端窗口里并行驱动 Claude Code**，每个窗口用**红绿灯**告诉你它在干活、在等你确认、还是已经空闲。

## 🚀 功能

| | 功能 | 说明 |
|---|---|---|
| 🛰 | **项目总览** | 扫描 `~/.claude/projects`，还原每个项目真实路径，按最近活跃排序 |
| 📋 | **需求** | 每个会话的首条消息就是你当时提的需求 |
| 📊 | **进度可下钻** | 合并 TodoWrite 任务 + superpowers `specs/` 复选框，环形进度 + 明细 |
| 🧠 | **4 层记忆** | `user / feedback / project / reference` 分组展示 |
| 🛠 | **技能** | 项目本地 `.claude/skills` + 全局技能，含描述 |
| 📄 | **工程文档** | `specs/ docs/ plans/` 里的 Markdown，浮窗内直接阅读 |
| 🔢 | **Token & 剩余额度** | 每会话/每项目/全局用量 + 近 30 天柱状图 + 实时读取 `/usage` 真实剩余百分比 |
| 🖥 | **真终端并行** | 每个会话一个真正的交互式 `claude`（PTY + xterm），可拖动/缩放/最小化/独立窗口 |
| 🚦 | **红绿灯状态** | 🔴进行中 / 🟡等你确认 / 🟢空闲，最小化也看得到 |
| 🍎 | **Mac 客户端** | Electron 原生窗口，会话可脱离主窗口、拖到任意显示器 |

## 📦 安装与运行

需要 **Node.js ≥ 18** 和已安装并登录的 **`claude` CLI**。

```bash
git clone https://github.com/dengmingrui/helm-cc.git
cd helm-cc
npm install            # node-pty (原生) + ws + electron
```

**A. 浏览器模式**
```bash
npm start              # = node server.js，打开 http://localhost:4317
```

**B. Mac 客户端**
```bash
npm run app            # 原生窗口，会话弹独立窗口
```

或直接到 [Releases](https://github.com/dengmingrui/helm-cc/releases) 下载打好的 `.dmg`（仅 Apple Silicon）。

换端口：`PORT=8080 npm start` ｜ 指定 claude：`CLAUDE_BIN=/opt/homebrew/bin/claude npm start`

> ⚠️ 本工具会启动**真实的** Claude Code 子进程在你的项目目录下执行操作，请自行启动并知悉。数据全程在本机，不外传。

## 🚦 状态 Hooks（可选）

红绿灯默认靠终端输出**启发式推断**就能用。想要**权威精准**的状态（尤其「等你确认」🟡 和「完成」🟢），点仪表盘顶栏的 **状态** 按钮一键开启（会在 `~/.claude/settings.json` 写入 hooks，自动备份，可一键关闭）。

也可命令行操作：`npm run hooks` 开 / `node add-hooks.js --remove` 关。**绝不自动安装，永远要你确认。**

## 🏗 架构

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
- **electron/** — 桌面外壳：用系统/自带 Node 跑 server（避开 node-pty 的 Electron ABI 问题），会话以原生窗口呈现。

## 🍎 打包成 App

```bash
npm run dist           # electron-builder → dist/纯粹CC.dmg
```

## 🔧 技术备注

- **node-pty 与新版 Node**：若终端报 `posix_spawnp failed`，从源码重编一次：
  `cd node_modules/node-pty && npx node-gyp rebuild`（需 Xcode CLT + python3）。
- **xterm 本地化**：`public/vendor/` 已内置 xterm / addon-fit / marked，不依赖 CDN、可离线。
- **会话连续性**：终端用 `--session-id`（新）/ `--resume`（接续），会话自动落盘到 `~/.claude`，又出现在仪表盘里，形成闭环。
- **隐私守卫**：扫描时跳过家目录 / Documents / Downloads / iCloud / Library 等受保护目录，避免 macOS 文件访问弹窗。

## 📁 目录

```
server.js          实时数据 + PTY 终端 + hook 接收
add-hooks.js       一键装/卸状态 hooks（带备份）
electron/          桌面客户端 (main.js · preload.js)
public/            仪表盘 + 终端页 + 文档页 + vendor 库
```

## 📝 License

MIT · made by **存粹** · 2026
