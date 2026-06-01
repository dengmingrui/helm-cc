# Claude Code Command Deck ◢◤

一个 Sci-Fi HUD 风格的本地可视化面板，实时聚合你电脑上所有 Claude Code 项目的：

- **项目节点** — 扫描 `~/.claude/projects/`，自动还原每个项目的真实路径
- **需求** — 每个会话的首条用户消息（你当时提的需求原文）
- **进度（可下钻）** — 关联 `~/.claude/tasks/<sessionId>/*.json`，按 done / in-progress / pending 统计，环形进度 + 任务清单
- **4 层记忆** — 解析 `<project>/memory/*.md` 的 `type` 字段：`user · feedback · project · reference`

- **Token 用量** — 解析每条消息的 `usage`，统计每个会话、每个项目、全局的 token，并画近 30 天每日用量柱状图（输出 / 输入+缓存 分层）
- **会话管理** — 标记"临时会话"（无实质需求的短会话），支持**单个会话软删除**（不删项目），文件移入可恢复的回收站

数据**每次请求实时扫描磁盘**。**不再自动刷新**（避免打断），只在你点「重新扫描」时更新。

> Token 口径说明：`总 Token` 含输入+输出+缓存，数字很大是因为每轮对话都会重复读取缓存上下文（缓存读取很廉价）。真正反映"模型生成量"的是**输出**那一项。

## 删除会话 / 回收站

- 点项目卡片 → `会话 / 需求` 标签页 → 每个会话右侧有删除按钮，二次确认后删除
- **软删除**：文件被移动到 `~/.claude/projects/.deck-trash/<项目>/<会话>.jsonl.<时间戳>.bak`，**可随时恢复**（把 `.bak` 改回 `.jsonl` 移回原项目目录即可）
- 永不硬删除，永不动项目本身

## 依赖与启动

需要 Node.js + 已安装 `claude` CLI。依赖（两个）：
- `node-pty` — 给网页真终端造 PTY（原生模块，安装时会针对你的 Node 编译）
- `ws` — WebSocket（纯 JS）

```bash
cd cc-dashboard
npm install            # 安装 node-pty + ws
node server.js         # 或 npm start
```

然后浏览器打开 **http://localhost:4317**

换端口：`PORT=8080 node server.js` ｜ 指定 claude 路径：`CLAUDE_BIN=/opt/homebrew/bin/claude node server.js`

> ⚠️ 这个服务会用 PTY 跑真实的交互式 `claude`（见下方「网页内真终端」），属于"网页驱动的自治 agent"。**必须由你本人启动**，启动即代表你授权它在你的项目目录下执行操作。

### 若终端启动失败：`posix_spawnp failed`
说明 `node-pty` 的预编译版与你的 Node 版本不兼容（尤其是很新的 Node）。从源码重编一次即可：
```bash
cd node_modules/node-pty && npx node-gyp rebuild
```
（需要 Xcode 命令行工具 + python3）。服务端启动日志会显示 `terminal: enabled` 或 `DISABLED`。

## 网页内真终端 · 多窗口并行开发（JumpServer 式）

点 **`▶ 接续对话`** / 抽屉里会话的 **`▶`** / 窗格里的 **`＋`**，底部弹出一个**真正的终端**（xterm.js），
后端用 PTY 接真实的交互式 `claude` —— **这就是 CLI 本体**，不是复刻：

- 100% CLI 体验：权限提示、斜杠命令（`/model` `/clear` …）、Shift+Tab 切权限模式，全部原生可用
- 卡片 `▶ 接续对话` 默认 `claude --resume <最近会话>`，历史与上下文都在；`＋` 开全新 `claude`
- 可同时开多个终端窗格，并排在底部 Dock 里**并行开发**（像开多个 CLI 窗口）
- 终端会话自动存入 `~/.claude/projects`，**直接出现在仪表盘里**

> 💰 真实计费。多窗口并行时注意成本。
> 仪表盘的项目 / 需求 / 进度 / 4 层记忆 / Token 统计等分析，在终端窗格外围照常实时工作。

## 交互

- 点击任意**项目卡片** → 右侧抽屉下钻，三个标签页：`PROGRESS` / `REQUIREMENTS` / `MEMORY · 4L`
- 顶部 `RESCAN` 手动重扫；`ESC` 或点击遮罩关闭抽屉
- 顶部筛选：`ALL` / `IN PROGRESS` / `HAS MEMORY`

## 技术

纯原生 HTML/CSS/JS + Node 内置 `http`，无构建、无第三方包。Canvas 粒子星座背景、光标聚光卡片、环形/堆叠进度动画、抽屉滑入。全程支持 `prefers-reduced-motion`（关闭动画时优雅降级）。

> 视觉风格由 `taste-skill` 的 Dark-Tech / HUD 方向生成：单一 cyan 主色锁定、非纯黑底、UI 文案零 em-dash。
