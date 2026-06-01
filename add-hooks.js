#!/usr/bin/env node
// Safely merge the dashboard status hooks into ~/.claude/settings.json.
// Run:  node add-hooks.js        (use --remove to undo)
const fs = require('fs');
const path = require('path');
const os = require('os');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const PORT = process.env.PORT || 4317;
const CMD = `curl -s --max-time 1 -X POST http://localhost:${PORT}/api/hook -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true`;

const one = () => [{ hooks: [{ type: 'command', command: CMD }] }];
const matched = () => [{ matcher: '*', hooks: [{ type: 'command', command: CMD }] }];

let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('读取 settings.json 失败:', e.message); process.exit(1); }

// backup once
const bak = file + '.deck-bak';
if (!fs.existsSync(bak)) fs.writeFileSync(bak, JSON.stringify(settings, null, 2));

const KEYS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];

if (process.argv.includes('--remove')) {
  if (settings.hooks) {
    for (const k of KEYS) {
      if (!settings.hooks[k]) continue;
      settings.hooks[k] = settings.hooks[k].filter(g =>
        !(g.hooks || []).some(h => (h.command || '').includes('/api/hook')));
      if (settings.hooks[k].length === 0) delete settings.hooks[k];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log('✅ 已移除仪表盘 hooks（你原有的其它配置不变）');
  process.exit(0);
}

settings.hooks = settings.hooks || {};
const add = (key, factory) => {
  const arr = settings.hooks[key] || (settings.hooks[key] = []);
  // avoid duplicates
  const exists = arr.some(g => (g.hooks || []).some(h => (h.command || '').includes('/api/hook')));
  if (!exists) arr.push(...factory());
};
add('UserPromptSubmit', one);
add('PreToolUse', matched);
add('PostToolUse', matched);
add('Notification', one);
add('Stop', one);

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log('✅ 已写入仪表盘状态 hooks 到', file);
console.log('   备份保存在', bak);
console.log('   撤销：node add-hooks.js --remove');
