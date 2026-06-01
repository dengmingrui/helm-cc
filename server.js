#!/usr/bin/env node
'use strict';

/*
 * Claude Code Command Deck
 * Zero-dependency live server. Scans ~/.claude on every /api/data request,
 * so the dashboard always reflects the real, current state on disk.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let pty = null, WebSocketServer = null;
try { pty = require('node-pty'); } catch {}
try { WebSocketServer = require('ws').WebSocketServer; } catch {}

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 4317;

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const HOOK_KEYS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];

// ---------- status hooks: one-click install/remove from the dashboard ----------
function hookCmd() {
  return `curl -s --max-time 1 -X POST http://localhost:${PORT}/api/hook -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true`;
}
function hooksInstalled() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return !!(s.hooks && HOOK_KEYS.some(k => (s.hooks[k] || []).some(g => (g.hooks || []).some(h => (h.command || '').includes('/api/hook')))));
  } catch { return false; }
}
function setHooks(enable) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
  const bak = SETTINGS_FILE + '.deck-bak';
  try { if (!fs.existsSync(bak)) fs.writeFileSync(bak, JSON.stringify(s, null, 2)); } catch {}
  s.hooks = s.hooks || {};
  const clean = (k) => { if (s.hooks[k]) { s.hooks[k] = s.hooks[k].filter(g => !(g.hooks || []).some(h => (h.command || '').includes('/api/hook'))); if (!s.hooks[k].length) delete s.hooks[k]; } };
  HOOK_KEYS.forEach(clean);
  if (enable) {
    const cmd = hookCmd();
    const one = () => [{ hooks: [{ type: 'command', command: cmd }] }];
    const mat = () => [{ matcher: '*', hooks: [{ type: 'command', command: cmd }] }];
    s.hooks.UserPromptSubmit = one(); s.hooks.Notification = one(); s.hooks.Stop = one();
    s.hooks.PreToolUse = mat(); s.hooks.PostToolUse = mat();
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n');
  return hooksInstalled();
}

// ---------- helpers ----------

function safeReadDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
}

function localDay(ts) {
  // ISO timestamp -> local YYYY-MM-DD
  const d = new Date(ts);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function scanSession(jsonlPath, dailyAcc) {
  // Single full pass: first user message + token usage + per-day token accrual.
  let cwd = null, requirement = null, firstTs = null, model = null;
  const tok = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  let usageLines = 0;
  let raw;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); }
  catch { return { requirement: null, firstTs: null, cwd: null, tokens: tok, total: 0, usageLines: 0, model: null }; }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.cwd && !cwd) cwd = o.cwd;

    if (o.type === 'user' && requirement === null) {
      const m = o.message || {};
      const c = m.content;
      let txt = '';
      if (typeof c === 'string') txt = c;
      else if (Array.isArray(c)) txt = c.filter(b => b && b.type === 'text').map(b => b.text || '').join(' ');
      txt = (txt || '').trim();
      if (txt && !txt.startsWith('<') && !txt.startsWith('[{') && !txt.startsWith('Caveat:')) {
        requirement = txt; firstTs = o.timestamp || null;
      }
    }

    const m = o.message;
    const u = m && typeof m === 'object' ? m.usage : null;
    if (u) {
      usageLines++;
      if (m.model && !model) model = m.model;
      const i = u.input_tokens || 0, ot = u.output_tokens || 0;
      const cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
      tok.input += i; tok.output += ot; tok.cacheCreate += cc; tok.cacheRead += cr;
      if (dailyAcc) {
        const day = localDay(o.timestamp) || 'unknown';
        const d = dailyAcc[day] || (dailyAcc[day] = { total: 0, output: 0 });
        d.total += i + ot + cc + cr;
        d.output += ot;
      }
    }
  }
  const total = tok.input + tok.output + tok.cacheCreate + tok.cacheRead;
  return { requirement, firstTs, cwd, tokens: tok, total, usageLines, model };
}

function readTranscript(jsonlPath, cap = 160) {
  // Parse a session .jsonl into a flat, display-friendly message list.
  let raw;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); }
  catch { return { items: [], total: 0, truncated: false }; }

  const items = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message;

    if (o.type === 'user' && m && typeof m === 'object') {
      const c = m.content;
      let txt = '';
      if (typeof c === 'string') txt = c;
      else if (Array.isArray(c)) {
        // skip tool_result-only user turns
        if (c.some(b => b && b.type === 'tool_result') && !c.some(b => b && b.type === 'text')) continue;
        txt = c.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
      }
      txt = (txt || '').trim();
      if (txt && !txt.startsWith('<') && !txt.startsWith('[{') && !txt.startsWith('Caveat:')) {
        items.push({ role: 'user', text: txt });
      }
    } else if (o.type === 'assistant' && m && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && b.text && b.text.trim()) items.push({ role: 'asst', text: b.text });
        else if (b.type === 'tool_use') items.push({ role: 'tool', name: b.name, input: b.input || {} });
      }
    }
  }
  const total = items.length;
  const truncated = total > cap;
  return { items: truncated ? items.slice(total - cap) : items, total, truncated };
}

function readTasksForSession(sessionId) {
  const dir = path.join(TASKS_DIR, sessionId);
  const out = { pending: 0, in_progress: 0, completed: 0, total: 0, items: [] };
  for (const ent of safeReadDir(dir)) {
    if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
    let o;
    try { o = JSON.parse(fs.readFileSync(path.join(dir, ent.name), 'utf8')); }
    catch { continue; }
    if (!o || !o.subject) continue;
    const st = o.status === 'in_progress' ? 'in_progress'
      : o.status === 'completed' ? 'completed' : 'pending';
    out[st]++; out.total++;
    out.items.push({
      id: o.id, subject: o.subject,
      description: o.description || '', status: st,
    });
  }
  out.items.sort((a, b) => Number(a.id) - Number(b.id));
  return out;
}

function parseFrontMatter(md) {
  // returns { meta: {...}, body }
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val && !/^\s/.test(line)) meta[key] = val;
  }
  return { meta, body: (m[2] || '').trim() };
}

function readMemory(projectDir) {
  const dir = path.join(projectDir, 'memory');
  const result = { user: [], feedback: [], project: [], reference: [], other: [], total: 0 };
  for (const ent of safeReadDir(dir)) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    if (ent.name === 'MEMORY.md') continue;
    let md;
    try { md = fs.readFileSync(path.join(dir, ent.name), 'utf8'); } catch { continue; }
    const { meta, body } = parseFrontMatter(md);
    const type = (meta.type || meta.metadata || 'other').toLowerCase();
    const bucket = MEMORY_TYPES.includes(type) ? type : 'other';
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, ent.name)).mtimeMs; } catch {}
    result[bucket].push({
      file: ent.name,
      name: meta.name || ent.name.replace(/\.md$/, ''),
      description: meta.description || '',
      type: bucket,
      body,
      mtime,
    });
    result.total++;
  }
  return result;
}

function readSkills(baseDir) {
  // baseDir = a project cwd OR ~/.claude ; reads <baseDir>/.claude/skills or <baseDir>/skills
  const candidates = [path.join(baseDir, '.claude', 'skills'), path.join(baseDir, 'skills')];
  for (const dir of candidates) {
    const ents = safeReadDir(dir);
    if (!ents.length) continue;
    const out = [];
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const sk = path.join(dir, ent.name, 'SKILL.md');
      let name = ent.name, description = '';
      try {
        const { meta } = parseFrontMatter(fs.readFileSync(sk, 'utf8'));
        name = meta.name || ent.name;
        description = meta.description || '';
      } catch { continue; } // no SKILL.md -> not a skill dir
      out.push({ dir: ent.name, name, description });
    }
    if (out.length) return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [];
}

function walkMd(dir, baseLen, out, depth) {
  if (depth > 4 || out.length > 200) return;
  for (const ent of safeReadDir(dir)) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.git')) continue;
      walkMd(full, baseLen, out, depth + 1);
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      let mtime = 0, size = 0;
      try { const st = fs.statSync(full); mtime = st.mtimeMs; size = st.size; } catch {}
      out.push({ rel: full.slice(baseLen), name: ent.name.replace(/\.md$/, ''), folder: path.dirname(full.slice(baseLen)), mtime, size });
    }
  }
}

function readDocs(projectCwd) {
  // Superpowers / planning docs typically land in specs/ docs/ plans/ thoughts/
  const out = [];
  for (const sub of ['specs', 'docs', 'plans', 'thoughts']) {
    const dir = path.join(projectCwd, sub);
    if (fs.existsSync(dir)) walkMd(dir, projectCwd.length + 1, out, 0);
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function readCheckboxes(projectCwd, docs) {
  // superpowers / plan docs track progress with markdown checkboxes
  let done = 0, total = 0;
  for (const d of docs) {
    if (d.size > 1024 * 1024) continue; // skip very large
    let txt; try { txt = fs.readFileSync(path.join(projectCwd, d.rel), 'utf8'); } catch { continue; }
    const lines = txt.match(/^[ \t]*[-*] \[[ xX]\]/gm);
    if (!lines) continue;
    for (const l of lines) { total++; if (/\[[xX]\]/.test(l)) done++; }
  }
  return { done, total };
}

function decodePath(dirName, fallbackCwd) {
  if (fallbackCwd) return fallbackCwd;
  // best-effort: "-Users-rui-project-foo" -> "/Users/rui/project/foo"
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

function shortName(realPath, dirName) {
  const base = (realPath || dirName).split('/').filter(Boolean).pop();
  return base || dirName;
}

function scanAll() {
  const projects = [];
  const daily = {}; // global per-day token accrual
  let totals = { projects: 0, sessions: 0, requirements: 0, memories: 0,
    tasks: 0, tasksDone: 0, tasksActive: 0,
    tokenTotal: 0, tokenOutput: 0, tokenInput: 0, tokenCache: 0, ephemeral: 0 };

  for (const ent of safeReadDir(PROJECTS_DIR)) {
    if (!ent.isDirectory()) continue;
    const dirName = ent.name;
    if (dirName.startsWith('.')) continue; // skip trash/hidden
    const projectDir = path.join(PROJECTS_DIR, dirName);

    const sessions = [];
    let projCwd = null;
    let lastActive = 0;
    const taskAgg = { pending: 0, in_progress: 0, completed: 0, total: 0 };
    const projTok = { total: 0, output: 0, input: 0, cache: 0 };

    for (const f of safeReadDir(projectDir)) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const sessionId = f.name.replace(/\.jsonl$/, '');
      const full = path.join(projectDir, f.name);
      let mtime = 0, size = 0;
      try { const st = fs.statSync(full); mtime = st.mtimeMs; size = st.size; } catch {}
      if (mtime > lastActive) lastActive = mtime;

      const s = scanSession(full, daily);
      if (s.cwd && !projCwd) projCwd = s.cwd;

      const tasks = readTasksForSession(sessionId);
      taskAgg.pending += tasks.pending;
      taskAgg.in_progress += tasks.in_progress;
      taskAgg.completed += tasks.completed;
      taskAgg.total += tasks.total;

      const cache = s.tokens.cacheCreate + s.tokens.cacheRead;
      projTok.total += s.total; projTok.output += s.tokens.output;
      projTok.input += s.tokens.input; projTok.cache += cache;

      // ephemeral = throwaway: no real requirement, or very few model turns
      const ephemeral = !s.requirement || s.usageLines <= 3;
      if (ephemeral) totals.ephemeral++;

      sessions.push({
        sessionId, requirement: s.requirement, firstTs: s.firstTs, mtime, size,
        tasks, ephemeral, model: s.model, usageLines: s.usageLines,
        tokens: {
          total: s.total, output: s.tokens.output,
          input: s.tokens.input, cache,
        },
      });
    }

    if (sessions.length === 0) continue; // skip empty project dirs

    const memory = readMemory(projectDir);
    const realPath = decodePath(dirName, projCwd);
    const skills = projCwd ? readSkills(realPath) : [];
    const docs = projCwd ? readDocs(realPath) : [];
    const checkboxes = projCwd ? readCheckboxes(realPath, docs) : { done: 0, total: 0 };

    sessions.sort((a, b) => b.mtime - a.mtime);

    // progress combines TodoWrite tasks AND superpowers todos.md checkboxes
    const progDone = taskAgg.completed + checkboxes.done;
    const progTotal = taskAgg.total + checkboxes.total;
    const progress = progTotal > 0 ? Math.round((progDone / progTotal) * 100) : null;

    projects.push({
      dirName,
      name: shortName(realPath, dirName),
      realPath,
      sessionCount: sessions.length,
      requirementCount: sessions.filter(s => s.requirement).length,
      lastActive,
      tasks: taskAgg,
      checkboxes,
      progress,
      tokens: projTok,
      skills,
      skillCount: skills.length,
      docs,
      docCount: docs.length,
      memory: {
        total: memory.total,
        user: memory.user, feedback: memory.feedback,
        project: memory.project, reference: memory.reference,
        other: memory.other,
        counts: {
          user: memory.user.length, feedback: memory.feedback.length,
          project: memory.project.length, reference: memory.reference.length,
          other: memory.other.length,
        },
      },
      sessions,
    });

    totals.projects++;
    totals.sessions += sessions.length;
    totals.requirements += sessions.filter(s => s.requirement).length;
    totals.memories += memory.total;
    totals.tasks += taskAgg.total + checkboxes.total;
    totals.tasksDone += taskAgg.completed + checkboxes.done;
    totals.tasksActive += taskAgg.in_progress + taskAgg.pending + (checkboxes.total - checkboxes.done);
    totals.tokenTotal += projTok.total;
    totals.tokenOutput += projTok.output;
    totals.tokenInput += projTok.input;
    totals.tokenCache += projTok.cache;
  }

  // build a continuous daily series for the last 30 days
  const dailySeries = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = daily[key] || { total: 0, output: 0 };
    dailySeries.push({ date: key, total: v.total, output: v.output });
  }

  const globalSkills = readSkills(CLAUDE_DIR);
  projects.sort((a, b) => b.lastActive - a.lastActive);
  return { generatedAt: Date.now(), totals, projects, daily: dailySeries, globalSkills };
}

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const TRASH_DIR = path.join(PROJECTS_DIR, '.deck-trash');

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function deleteSession(dirName, sessionId) {
  // Soft-delete: move the .jsonl into a recoverable trash folder. Never hard-unlink.
  if (!/^[-_a-zA-Z0-9.]+$/.test(dirName) || /\.\./.test(dirName)) throw new Error('bad dirName');
  if (!/^[-a-fA-F0-9]+$/.test(sessionId)) throw new Error('bad sessionId');
  const src = path.join(PROJECTS_DIR, dirName, sessionId + '.jsonl');
  const resolved = path.resolve(src);
  if (!resolved.startsWith(path.resolve(PROJECTS_DIR) + path.sep)) throw new Error('out of bounds');
  if (!fs.existsSync(resolved)) throw new Error('session not found');
  const destDir = path.join(TRASH_DIR, dirName);
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = Date.now();
  const dest = path.join(destDir, `${sessionId}.jsonl.${stamp}.bak`);
  fs.renameSync(resolved, dest);
  return { trashed: dest };
}

// ===========================================================
//  Live chat manager — drive real Claude Code sessions per pane
// ===========================================================

// Resolve the claude binary robustly. A macOS app launched from Finder does NOT
// inherit the shell PATH, so `claude` alone won't be found — search common locations.
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const candidates = [
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
    path.join(os.homedir(), '.claude/local/claude'),
    path.join(os.homedir(), '.npm-global/bin/claude'),
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.bun/bin/claude'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  try {
    const out = require('child_process').execSync('zsh -lc "command -v claude" 2>/dev/null || bash -lc "command -v claude" 2>/dev/null', { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out.split('\n').pop().trim())) return out.split('\n').pop().trim();
  } catch {}
  return 'claude';
}
const CLAUDE_BIN = resolveClaudeBin();
const panes = new Map(); // paneId -> pane
const terminals = new Map(); // sessionId -> { ws } : live PTY terminals, keyed by claude session id

function hookToState(event, message) {
  if (event === 'Stop' || event === 'SubagentStop') return 'idle';
  if (event === 'Notification') {
    // Notification fires for permission requests AND idle-waiting reminders; disambiguate by message
    if (/waiting for your input|idle|been waiting/i.test(message || '')) return 'idle';
    return 'wait';
  }
  if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'PostToolUse') return 'busy';
  return null;
}

let paneSeq = 0;
function newPaneId() { return 'pane_' + (++paneSeq) + '_' + Date.now().toString(36); }

function sse(pane, event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of pane.clients) { try { c.write(line); } catch {} }
}

function parseUsage(raw) {
  // strip ANSI + OSC, drop block-drawing chars and whitespace so labels/percentages collapse predictably
  let s = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\x1b[78=>]/g, '');
  s = s.replace(/[─-▟\s]/g, '');
  const low = s.toLowerCase();
  const grabPct = (label) => {
    const i = low.indexOf(label); if (i < 0) return null;
    const m = s.slice(i, i + 140).match(/(\d{1,3})%/); return m ? parseInt(m[1], 10) : null;
  };
  const grabReset = (label) => {
    const i = low.indexOf(label); if (i < 0) return null;
    const seg = s.slice(i, i + 180);
    const m = seg.match(/[Rr]ese\w*?([A-Z][a-z]{2}\d{1,2}at\d{1,2}(?::\d\d)?[AaPp][Mm]|\d{1,2}(?::\d\d)?[AaPp][Mm])/);
    return m ? m[1].replace(/at/, ' at ').replace(/([A-Z][a-z]{2})(\d)/, '$1 $2') : null;
  };
  return {
    session: grabPct('currentsession'),
    sessionReset: grabReset('currentsession'),
    weekAll: grabPct('currentweek(allmodels)'),
    weekAllReset: grabReset('currentweek(allmodels)'),
    weekSonnet: grabPct('currentweek(sonnetonly)'),
    at: Date.now(),
  };
}

function modeArgs(mode) {
  if (mode === 'plan') return ['--permission-mode', 'plan'];
  if (mode === 'bypass') return ['--dangerously-skip-permissions'];
  return ['--permission-mode', 'acceptEdits']; // default "auto"
}

function startPane({ dirName, cwd, resumeSessionId, mode }) {
  const paneId = newPaneId();
  const pane = {
    paneId, dirName, cwd: cwd || os.homedir(),
    sessionId: resumeSessionId || null,
    mode: mode || 'auto',
    busy: false, child: null, procMode: null, clients: [], buf: '', errBuf: '',
  };
  panes.set(paneId, pane);
  return pane;
}

// Spawn ONE long-lived claude process per pane (real CLI-like live session).
// Respawn only if it died, or if the permission mode changed (mode is a launch flag).
function ensureProc(pane) {
  if (pane.child && !pane.child.killed && pane.procMode === pane.mode) return;
  if (pane.child) { try { pane.child.kill('SIGTERM'); } catch {} pane.child = null; }

  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '-p', ...modeArgs(pane.mode)];
  if (pane.sessionId) args.push('--resume', pane.sessionId);

  const child = spawn(CLAUDE_BIN, args, { cwd: pane.cwd, env: process.env });
  pane.child = child; pane.procMode = pane.mode; pane.buf = ''; pane.errBuf = '';

  child.stdout.on('data', (chunk) => {
    pane.buf += chunk.toString();
    let idx;
    while ((idx = pane.buf.indexOf('\n')) >= 0) {
      const line = pane.buf.slice(0, idx).trim();
      pane.buf = pane.buf.slice(idx + 1);
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'init' && o.session_id && pane.sessionId !== o.session_id) {
        pane.sessionId = o.session_id;
        sse(pane, { type: 'session', sessionId: o.session_id });
      }
      sse(pane, { type: 'event', event: o });
      if (o.type === 'result') { pane.busy = false; sse(pane, { type: 'turn_end' }); }
    }
  });
  child.stderr.on('data', (c) => { pane.errBuf += c.toString(); });
  child.on('error', (e) => {
    pane.child = null; pane.busy = false;
    sse(pane, { type: 'fatal', error: '无法启动 claude: ' + e.message });
  });
  child.on('close', (code) => {
    const wasBusy = pane.busy;
    pane.child = null; pane.busy = false;
    if (code && pane.errBuf) sse(pane, { type: 'stderr', code, text: pane.errBuf.slice(0, 800) });
    // unexpected death mid-turn: tell the UI; next send auto-respawns with --resume
    if (wasBusy) sse(pane, { type: 'proc_exit', code });
  });
}

function paneSend(pane, text) {
  if (pane.busy) throw new Error('该窗格正在生成中，请稍候');
  ensureProc(pane);
  pane.busy = true;
  sse(pane, { type: 'turn_start', mode: pane.mode, resumed: !!pane.sessionId });
  const frame = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
  try {
    pane.child.stdin.write(frame);
  } catch (e) {
    // stdin broke (process died) — respawn once and retry
    pane.child = null; ensureProc(pane);
    try { pane.child.stdin.write(frame); }
    catch (e2) { pane.busy = false; sse(pane, { type: 'fatal', error: '发送失败: ' + e2.message }); }
  }
}

// ===========================================================

const server = http.createServer(async (req, res) => {
  const route = req.url.split('?')[0];

  // ---- live chat: open SSE stream for a pane ----
  if (route === '/api/chat/stream') {
    const paneId = new URL(req.url, 'http://x').searchParams.get('paneId');
    const pane = panes.get(paneId);
    if (!pane) { res.writeHead(404); res.end('no pane'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache', 'Connection': 'keep-alive',
    });
    res.write(`retry: 3000\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'ready', paneId, sessionId: pane.sessionId, mode: pane.mode, cwd: pane.cwd })}\n\n`);
    pane.clients.push(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); pane.clients = pane.clients.filter(c => c !== res); });
    return;
  }

  if (route === '/api/chat/start' && req.method === 'POST') {
    try {
      const { dirName, cwd, resumeSessionId, mode } = await readBody(req);
      const pane = startPane({ dirName, cwd, resumeSessionId, mode });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, paneId: pane.paneId, sessionId: pane.sessionId, cwd: pane.cwd, mode: pane.mode }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/chat/send' && req.method === 'POST') {
    try {
      const { paneId, text, mode } = await readBody(req);
      const pane = panes.get(paneId);
      if (!pane) throw new Error('窗格不存在');
      if (mode) pane.mode = mode;
      if (!text || !text.trim()) throw new Error('空消息');
      paneSend(pane, text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/chat/stop' && req.method === 'POST') {
    try {
      const { paneId } = await readBody(req);
      const pane = panes.get(paneId);
      if (pane) {
        if (pane.child) { try { pane.child.kill('SIGTERM'); } catch {} }
        for (const c of pane.clients) { try { c.end(); } catch {} }
        panes.delete(paneId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/data') {
    try {
      const data = scanAll();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.stack || e) }));
    }
    return;
  }

  if (route === '/api/session/messages') {
    try {
      const q = new URL(req.url, 'http://x').searchParams;
      const dirName = q.get('dirName'), sessionId = q.get('sessionId');
      if (!/^[-_a-zA-Z0-9.]+$/.test(dirName || '') || /\.\./.test(dirName || '')) throw new Error('bad dirName');
      if (!/^[-a-fA-F0-9]+$/.test(sessionId || '')) throw new Error('bad sessionId');
      const file = path.join(PROJECTS_DIR, dirName, sessionId + '.jsonl');
      const items = readTranscript(file);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, items: items.items, truncated: items.truncated, total: items.total }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/hooks/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ installed: hooksInstalled(), settingsFile: SETTINGS_FILE }));
    return;
  }
  if (route === '/api/hooks/toggle' && req.method === 'POST') {
    try {
      const { enable } = await readBody(req);
      const installed = setHooks(!!enable);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, installed }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/hook' && req.method === 'POST') {
    try {
      const p = await readBody(req);
      const event = p.hook_event_name || p.hookEventName;
      const sid = p.session_id || p.sessionId;
      const state = hookToState(event, p.message);
      if (sid && state) {
        const term = terminals.get(sid);
        if (term && term.ws) { try { term.ws.send(JSON.stringify({ t: 'state', state, event })); } catch {} }
      }
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (route === '/api/doc') {
    try {
      const q = new URL(req.url, 'http://x').searchParams;
      const cwd = q.get('cwd') || '', rel = q.get('rel') || '';
      if (!rel.endsWith('.md')) throw new Error('only .md');
      const resolved = path.resolve(cwd, rel);
      if (!resolved.startsWith(path.resolve(cwd) + path.sep)) throw new Error('out of bounds');
      const text = fs.readFileSync(resolved, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, text }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  if (route === '/api/usage/probe' && req.method === 'POST') {
    // Drive the interactive `/usage` view via PTY and scrape the real percentages.
    if (!pty) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'node-pty 不可用' })); return; }
    const t = pty.spawn(CLAUDE_BIN, [], { name: 'xterm-256color', cols: 100, rows: 44, cwd: os.homedir(), env: process.env });
    let out = '', done = false;
    const finish = (err, data) => {
      if (done) return; done = true;
      clearInterval(poll);
      try { t.write('\x03'); } catch {}
      setTimeout(() => { try { t.kill(); } catch {} }, 250);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(err ? { ok: false, error: err.message } : { ok: true, usage: data }));
    };
    t.onData((d) => { out += d; });
    setTimeout(() => { try { t.write('/usage\r'); } catch {} }, 2500);
    setTimeout(() => { try { t.write('/usage\r'); } catch {} }, 7000); // resend if TUI wasn't ready
    // poll until the usage data has actually rendered
    const poll = setInterval(() => {
      const u = parseUsage(out);
      if (u.session != null || u.weekAll != null) finish(null, u);
    }, 700);
    setTimeout(() => { const u = parseUsage(out); finish(u.session != null || u.weekAll != null ? null : new Error('未能读取 /usage（超时）'), u); }, 24000);
    return;
  }

  if (route === '/api/session/delete' && req.method === 'POST') {
    try {
      const { dirName, sessionId } = await readBody(req);
      const r = deleteSession(dirName, sessionId);
      console.log(`  [trash] ${sessionId} -> ${r.trashed}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trashed: r.trashed }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  serveStatic(req, res);
});

// ===========================================================
//  Real terminal — attach a PTY running the genuine `claude` CLI
//  over WebSocket (JumpServer-style). Full-fidelity interactive CLI.
// ===========================================================
if (pty && WebSocketServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/api/term') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => openTerminal(ws, u.searchParams));
  });

  function openTerminal(ws, q) {
    const cwd = q.get('cwd') && fs.existsSync(q.get('cwd')) ? q.get('cwd') : os.homedir();
    const sid = q.get('sessionId');
    const isResume = q.get('resume') === '1';
    const cols = Math.max(20, parseInt(q.get('cols')) || 100);
    const rows = Math.max(6, parseInt(q.get('rows')) || 30);

    const args = [];
    if (sid && /^[-a-fA-F0-9]+$/.test(sid)) {
      args.push(isResume ? '--resume' : '--session-id', sid);
    }

    // if this session is already live elsewhere (e.g. popping out), close it and let it release first
    const existing = sid && terminals.get(sid);
    const delay = existing ? 500 : 0;
    if (existing && existing.ws && existing.ws !== ws) { try { existing.ws.close(); } catch {} }

    setTimeout(() => spawn(), delay);

    function spawn() {
    let term;
    try {
      term = pty.spawn(CLAUDE_BIN, args, {
        name: 'xterm-256color', cols, rows, cwd, env: process.env,
      });
    } catch (e) {
      try { ws.send(JSON.stringify({ t: 'err', m: '无法启动终端: ' + e.message })); } catch {}
      ws.close(); return;
    }

    // register by session id so /api/hook can route state events to this terminal
    if (sid) terminals.set(sid, { ws });

    term.onData((d) => { try { ws.send(JSON.stringify({ t: 'o', d })); } catch {} });
    term.onExit(({ exitCode }) => { try { ws.send(JSON.stringify({ t: 'exit', code: exitCode })); ws.close(); } catch {} });

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'i') { try { term.write(m.d); } catch {} }
      else if (m.t === 'r') { try { term.resize(Math.max(20, m.cols | 0), Math.max(6, m.rows | 0)); } catch {} }
    });
    ws.on('close', () => { try { term.kill(); } catch {} if (sid && terminals.get(sid) && terminals.get(sid).ws === ws) terminals.delete(sid); });
    try { ws.send(JSON.stringify({ t: 'ready', cwd, sessionId: sid, resumed: isResume })); } catch {}
    } // end spawn()
  }
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  ◢◤ 纯粹CC · Claude Code 驾驶舱`);
    console.log(`  live at  http://localhost:${PORT}`);
    console.log(`  terminal: ${pty && WebSocketServer ? 'enabled (PTY+WS)' : 'DISABLED — run: npm install node-pty ws'}\n`);
    console.log(`  scanning ${PROJECTS_DIR}\n`);
  });
}

module.exports = { scanAll, readSkills, readDocs };
