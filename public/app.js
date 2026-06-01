'use strict';

/* =========================================================
   Claude Code Command Deck — front-end logic
   ========================================================= */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let STATE = { projects: [], totals: {} };
let FILTER = 'all';

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ago(ms) {
  if (!ms) return '未知';
  const d = Date.now() - ms, m = 60000, h = 3600000, day = 86400000;
  if (d < m) return '刚刚';
  if (d < h) return Math.floor(d / m) + ' 分钟前';
  if (d < day) return Math.floor(d / h) + ' 小时前';
  if (d < day * 30) return Math.floor(d / day) + ' 天前';
  return Math.floor(d / day / 30) + ' 个月前';
}
function fmtTok(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `<span class="ic">✓</span> ${esc(msg)}`;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function fmtTs(ts) {
  if (!ts) return '';
  const dt = new Date(ts);
  if (isNaN(dt)) return '';
  return dt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// count-up animation for stat numbers
function countUp(node, to) {
  if (REDUCED || to === '–') { node.textContent = to; return; }
  const target = Number(to) || 0;
  const dur = 900, t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(target * e);
    if (p < 1) requestAnimationFrame(step);
    else node.textContent = target;
  }
  requestAnimationFrame(step);
}

// ---------- particle backdrop ----------
(function particles() {
  if (REDUCED) return;
  const cv = $('#bg-canvas'), ctx = cv.getContext('2d');
  let w, h, pts = [];
  function resize() {
    w = cv.width = innerWidth; h = cv.height = innerHeight;
    const n = Math.min(90, Math.floor(w * h / 22000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25,
      r: Math.random() * 1.4 + .4,
    }));
  }
  resize(); addEventListener('resize', resize);
  function tick() {
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fillStyle = 'rgba(34,211,238,.5)'; ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 13000) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(79,140,255,${.12 * (1 - d2 / 13000)})`; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ---------- data ----------
async function load(first) {
  const btn = $('#refresh'); btn.classList.add('spin');
  if (first) renderSkeleton();
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    STATE = await r.json();
    renderStats();
    renderTokenPanel();
    renderGrid();
    $('#proj-meta').textContent = `${STATE.totals.projects} 个项目`;
    flashClock();
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty">扫描失败 · ${esc(e.message)}</div>`;
  } finally {
    setTimeout(() => btn.classList.remove('spin'), 600);
  }
}

function flashClock() {
  const c = $('#live-clock'); c.textContent = '已同步 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------- stat rail ----------
function renderStats() {
  const t = STATE.totals;
  const cards = [
    { k: '项目', v: t.projects, cls: 'accent' },
    { k: '会话', v: t.sessions, cls: '' },
    { k: '需求', v: t.requirements, cls: '' },
    { k: '记忆 · 4 层', v: t.memories, cls: '' },
    { k: '已完成', v: t.tasksDone, cls: 'done', sub: '/' + t.tasks },
    { k: '待办进行中', v: t.tasksActive, cls: 'active' },
    { k: '总 Token', v: t.tokenTotal, cls: 'tok', text: fmtTok(t.tokenTotal) },
  ];
  const rail = $('#statrail'); rail.innerHTML = '';
  cards.forEach((c, i) => {
    const node = el('div', `stat ${c.cls} fade-up`);
    node.innerHTML = `<div class="k">${c.k}</div><div class="v"><span class="num">${c.text ? '0' : '0'}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</div>`;
    rail.appendChild(node);
    setTimeout(() => node.classList.add('in'), i * 70);
    if (c.text) setTimeout(() => { node.querySelector('.num').textContent = c.text; }, 250 + i * 70);
    else setTimeout(() => countUp(node.querySelector('.num'), c.v), 250 + i * 70);
  });
}

// ---------- remaining quota (live /usage probe) ----------
let LAST_QUOTA = null; // { session, sessionReset, weekAll, weekAllReset, weekSonnet, at }
function quotaColor(used) {
  if (used == null) return 'var(--ink-dim)';
  if (used >= 90) return 'var(--hot)';
  if (used >= 70) return 'var(--active)';
  return 'var(--done)';
}
function gauge(label, used, reset) {
  if (used == null) return '';
  const left = 100 - used, c = quotaColor(used);
  return `<div class="q-gauge" title="${label}：已用 ${used}%${reset ? ' · ' + reset + ' 重置' : ''}">
    <span class="q-gl">${esc(label)}</span>
    <span class="q-bar"><i style="width:${used}%;background:${c}"></i></span>
    <span class="q-pct" style="color:${c}">剩 ${left}%</span>
  </div>`;
}
function quotaHTML() {
  if (!LAST_QUOTA) return `<span class="q-led"></span><span class="q-text">剩余额度未检测</span><button class="q-btn" id="q-probe">检测剩余额度</button>`;
  const q = LAST_QUOTA;
  return `<div class="q-gauges">
      ${gauge('会话', q.session, q.sessionReset)}
      ${gauge('本周', q.weekAll, q.weekAllReset)}
    </div>
    <button class="q-btn" id="q-probe" title="重新读取 /usage">↻</button>`;
}
async function probeUsage() {
  const box = $('#quota'); if (!box) return;
  box.innerHTML = `<span class="q-led busy"></span><span class="q-text">读取 /usage 中…（约 10 秒）</span>`;
  try {
    const j = await (await fetch('/api/usage/probe', { method: 'POST' })).json();
    if (!j.ok || !j.usage) throw new Error(j.error || '无额度数据');
    LAST_QUOTA = j.usage;
    box.innerHTML = quotaHTML(); wireQuota();
    toast(`额度已更新 · 会话剩 ${100 - (j.usage.session ?? 0)}% · 本周剩 ${100 - (j.usage.weekAll ?? 0)}%`);
  } catch (e) {
    box.innerHTML = quotaHTML(); wireQuota();
    toast('额度读取失败：' + e.message);
  }
}
function wireQuota() { const b = $('#q-probe'); if (b) b.onclick = probeUsage; }

// ---------- token usage panel + daily chart ----------
function renderTokenPanel() {
  const t = STATE.totals, daily = STATE.daily || [];
  const max = Math.max(1, ...daily.map(d => d.total));
  const activeDays = daily.filter(d => d.total > 0).length;

  const bars = daily.map(d => {
    const hPct = d.total > 0 ? Math.max(2, d.total / max * 100) : 0;
    const oPct = d.total > 0 ? d.output / d.total * 100 : 0;
    const md = d.date.slice(5);
    return `<div class="col">
      <div class="tip"><b>${fmtTok(d.total)}</b> tokens<br><span class="og">输出 ${fmtTok(d.output)}</span><br>${d.date}</div>
      <div class="stk" data-h="${hPct}"><div class="o" style="height:${oPct}%"></div><div class="t" style="height:${100 - oPct}%"></div></div>
    </div>`;
  }).join('');

  // sparse x labels (every 5th day)
  const xlabels = daily.map((d, i) => `<span>${i % 5 === 0 ? d.date.slice(5) : ''}</span>`).join('');

  $('#token-panel').innerHTML = `
    <div class="panel-head">
      <h3>Token 用量 · 近 30 天</h3>
      <div class="quota" id="quota">${quotaHTML()}</div>
      <div class="legend"><span><i style="background:var(--done)"></i>输出</span><span><i style="background:rgba(155,140,255,.7)"></i>输入+缓存</span></div>
    </div>
    <div class="tok-breakdown">
      <span class="out">生成输出 <b>${fmtTok(t.tokenOutput)}</b></span>
      <span>新增输入 <b>${fmtTok(t.tokenInput)}</b></span>
      <span class="cache">缓存读写 <b>${fmtTok(t.tokenCache)}</b></span>
      <span>累计活跃 <b>${activeDays}</b> 天</span>
    </div>
    <div class="chart">${bars}</div>
    <div class="chart-x">${xlabels}</div>`;

  wireQuota();
  // animate bar heights
  requestAnimationFrame(() => {
    $('#token-panel').querySelectorAll('.stk').forEach((s, i) => {
      setTimeout(() => { s.style.height = s.dataset.h + '%'; }, REDUCED ? 0 : i * 18);
    });
  });
}

// ---------- project grid ----------
function renderSkeleton() {
  const g = $('#grid'); g.innerHTML = '';
  for (let i = 0; i < 6; i++) g.appendChild(el('div', 'skel'));
}

function ringSVG(p) {
  const R = 19, C = 2 * Math.PI * R;
  if (p == null) return `<div class="ring none"><svg width="46" height="46"><circle class="track" cx="23" cy="23" r="${R}" fill="none" stroke-width="3"/></svg><div class="pct">–</div></div>`;
  const off = C * (1 - p / 100);
  return `<div class="ring"><svg width="46" height="46"><circle class="track" cx="23" cy="23" r="${R}" fill="none" stroke-width="3"/><circle class="fill" cx="23" cy="23" r="${R}" fill="none" stroke-width="3" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${off}"/></svg><div class="pct">${p}%</div></div>`;
}

function miniBar(tasks) {
  if (!tasks || !tasks.total) return '';
  const d = tasks.completed / tasks.total * 100;
  const a = tasks.in_progress / tasks.total * 100;
  const p = tasks.pending / tasks.total * 100;
  return `<div class="minibar"><i class="done" style="width:${d}%"></i><i class="active" style="width:${a}%"></i><i class="pending" style="width:${p}%"></i></div>`;
}

function visibleProjects() {
  return STATE.projects.filter(p => {
    if (FILTER === 'progress') return p.progress != null && p.progress < 100;
    if (FILTER === 'memory') return p.memory && p.memory.total > 0;
    return true;
  });
}

function renderGrid() {
  const g = $('#grid'); g.innerHTML = '';
  const list = visibleProjects();
  if (!list.length) { g.innerHTML = `<div class="empty">没有匹配该筛选的项目</div>`; return; }

  list.forEach((p, i) => {
    const reqs = p.sessions.filter(s => s.requirement).slice(0, 3);
    const moreReq = p.requirementCount - reqs.length;
    const memTotal = p.memory.total;
    const card = el('div', 'card fade-up');
    card.dataset.idx = STATE.projects.indexOf(p);
    card.innerHTML = `
      <span class="corner tl"></span><span class="corner br"></span>
      <div class="card-top">
        <div style="flex:1;min-width:0">
          <div class="pname">${esc(p.name)}</div>
          <div class="ppath">${esc(p.realPath)}</div>
        </div>
        ${ringSVG(p.progress)}
      </div>
      <div class="reqs">
        ${reqs.map(s => `<div class="req-line"><span class="tick"></span><span>${esc(s.requirement)}</span></div>`).join('') || '<div class="req-more">无显式需求记录</div>'}
        ${moreReq > 0 ? `<div class="req-more">还有 ${moreReq} 条需求</div>` : ''}
      </div>
      <div class="card-foot">
        <span class="pill sess">${p.sessionCount} 个会话</span>
        ${p.tokens && p.tokens.total ? `<span class="pill mem"><span class="d" style="background:var(--mem-project)"></span>${fmtTok(p.tokens.total)} tok</span>` : ''}
        ${memTotal ? `<span class="pill task" style="border-color:rgba(52,224,161,.3);color:var(--done)">${memTotal} 记忆</span>` : ''}
        ${p.skillCount ? `<span class="pill task" style="border-color:rgba(34,211,238,.35);color:var(--accent)">${p.skillCount} 技能</span>` : ''}
        ${p.docCount ? `<span class="pill task" style="border-color:rgba(255,200,87,.35);color:var(--active)">${p.docCount} 文档</span>` : ''}
        ${p.tasks.total ? `<span class="pill task">${p.tasks.completed}/${p.tasks.total} 任务</span>` : ''}
        <button class="btn-chat" data-chat style="margin-left:auto" title="接续最近会话，保留上下文">▶ 接续对话</button>
      </div>
      <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--ink-faint);text-align:right;margin-top:6px">${ago(p.lastActive)}</div>
      ${miniBar(p.tasks)}`;
    g.appendChild(card);

    // cursor spotlight
    if (!REDUCED) card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    const chatBtn = card.querySelector('[data-chat]');
    if (chatBtn) chatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = STATE.projects[card.dataset.idx];
      // default: resume the most recent session so Claude keeps full context
      const latest = proj.sessions && proj.sessions[0] && proj.sessions[0].sessionId;
      openChat(proj, latest);
    });
    card.addEventListener('click', () => openDrawer(STATE.projects[card.dataset.idx]));

    setTimeout(() => {
      card.classList.add('in');
      const f = card.querySelector('.ring .fill');
      if (f) requestAnimationFrame(() => f.style.strokeDashoffset = f.dataset.off);
    }, i * 45);
  });
}

// ---------- drawer / drill-down ----------
let DRAWER_TAB = 'progress';

function openDrawer(p) {
  DRAWER_TAB = 'progress';
  const head = $('#drawer-head');
  head.innerHTML = `
    <button class="close" id="drawer-close">×</button>
    <h3>${esc(p.name)}</h3>
    <div class="dpath">${esc(p.realPath)}</div>
    <div class="dstats">
      <div class="dstat"><b style="color:var(--accent)">${p.sessionCount}</b><span>会话</span></div>
      <div class="dstat"><b>${p.requirementCount}</b><span>需求</span></div>
      <div class="dstat"><b style="color:var(--done)">${p.progress == null ? '–' : p.progress + '%'}</b><span>进度</span></div>
      <div class="dstat"><b style="color:var(--mem-project)">${p.memory.total}</b><span>记忆</span></div>
    </div>`;
  $('#drawer-close').onclick = closeDrawer;

  const tabs = $('#drawer-tabs');
  tabs.innerHTML = '';
  const tabDefs = [
    { id: 'progress', label: '进度', badge: p.tasks.total || 0 },
    { id: 'requirements', label: '会话 / 需求', badge: p.sessionCount },
    { id: 'skills', label: '技能', badge: p.skillCount || 0 },
    { id: 'docs', label: '文档', badge: p.docCount || 0 },
    { id: 'memory', label: '记忆 · 4 层', badge: p.memory.total },
  ];
  tabDefs.forEach(td => {
    const b = el('button', 'tab' + (td.id === DRAWER_TAB ? ' on' : ''));
    b.innerHTML = `${td.label}<span class="badge">${td.badge}</span>`;
    b.onclick = () => { DRAWER_TAB = td.id; [...tabs.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); renderDrawerBody(p); };
    tabs.appendChild(b);
  });

  renderDrawerBody(p);
  $('#scrim').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  $('#scrim').classList.remove('open');
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
}

function renderDrawerBody(p) {
  const body = $('#drawer-body');
  if (DRAWER_TAB === 'progress') body.innerHTML = viewProgress(p);
  else if (DRAWER_TAB === 'requirements') body.innerHTML = viewRequirements(p);
  else if (DRAWER_TAB === 'skills') body.innerHTML = viewSkills(p);
  else if (DRAWER_TAB === 'docs') { body.innerHTML = viewDocs(p); wireDocs(p, body); }
  else body.innerHTML = viewMemory(p);
  body.scrollTop = 0;
  // animate task progress bars
  body.querySelectorAll('.task-prog').forEach(bar => {
    const fills = bar.querySelectorAll('i');
    fills.forEach(f => { const w = f.dataset.w; f.style.width = '0'; requestAnimationFrame(() => f.style.width = w + '%'); });
  });
  // wire resume + delete buttons on session rows
  body.querySelectorAll('.sess-row').forEach(row => {
    const resumeBtn = row.querySelector('.resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', () => {
      openChat(p, row.dataset.sid, true); closeDrawer();
    });
    const delBtn = row.querySelector('.del-btn:not(.resume-btn)');
    if (delBtn) delBtn.addEventListener('click', () => {
      const confirm = el('div', 'del-confirm');
      confirm.innerHTML = `<button class="yes">确认删除</button><button class="no">取消</button>`;
      delBtn.replaceWith(confirm);
      confirm.querySelector('.no').onclick = () => renderDrawerBody(p);
      confirm.querySelector('.yes').onclick = () =>
        doDeleteSession(row.dataset.dir, row.dataset.sid);
    });
  });
}

function viewProgress(p) {
  const sessions = p.sessions.filter(s => s.tasks && s.tasks.total > 0);
  const cb = p.checkboxes || { done: 0, total: 0 };

  if (!sessions.length && !p.tasks.total && !cb.total)
    return `<div class="empty">该项目暂无进度记录<br><br>进度来自 TodoWrite 任务，或 specs/ 文档里的复选框</div>`;

  // superpowers todos.md / plan checkbox progress
  const cbBlock = cb.total ? `
    <div style="margin-bottom:22px">
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);margin-bottom:7px">
        <span>文档清单进度（specs/ 复选框）· ${cb.done}/${cb.total}</span><span>${Math.round(cb.done / cb.total * 100)}%</span>
      </div>
      <div class="task-prog"><i class="done" data-w="${cb.done / cb.total * 100}"></i></div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-faint)">来自 superpowers 工作流的 todos.md / plan 文档，详见「文档」标签页</div>
    </div>` : '';

  const overall = p.tasks.total ? `
    <div style="margin-bottom:22px">
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);margin-bottom:7px">
        <span>总体进度 · 已完成 ${p.tasks.completed}/${p.tasks.total}</span><span>${p.progress}%</span>
      </div>
      <div class="task-prog"><i class="done" data-w="${p.tasks.completed / p.tasks.total * 100}"></i><i class="active" data-w="${p.tasks.in_progress / p.tasks.total * 100}"></i></div>
    </div>` : '';

  return cbBlock + overall + sessions.map(s => {
    const t = s.tasks;
    return `<div style="margin-bottom:26px">
      <div class="tl-item" style="border:0;padding-left:0">
        <div class="when">${esc(fmtTs(s.firstTs) || ago(s.mtime))}</div>
        <div class="req">${esc(s.requirement || '(无需求标题)')}</div>
      </div>
      <div class="task-prog"><i class="done" data-w="${t.completed / t.total * 100}"></i><i class="active" data-w="${t.in_progress / t.total * 100}"></i></div>
      <div class="tasks">
        ${t.items.map(it => `
          <div class="task-row ${it.status}">
            <span class="st"></span>
            <div style="flex:1">
              <div class="subj">${esc(it.subject)}</div>
              ${it.description ? `<div class="desc">${esc(it.description)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function viewRequirements(p) {
  if (!p.sessions.length) return `<div class="empty">该项目暂无会话</div>`;
  const tempCount = p.sessions.filter(s => s.ephemeral).length;
  const note = `<div class="del-note">共 ${p.sessions.length} 个会话${tempCount ? ` · 其中 ${tempCount} 个临时会话` : ''}。删除只移除会话本身（不影响项目），文件会移到可恢复的回收站 <span style="color:var(--ink-dim)">~/.claude/projects/.deck-trash/</span></div>`;

  const rows = p.sessions.map(s => `
    <div class="sess-row" data-sid="${esc(s.sessionId)}" data-dir="${esc(p.dirName)}">
      <div class="body">
        <div class="rq">${esc(s.requirement || '（无实质需求 · 临时会话）')}</div>
        <div class="mt">
          <span>${esc(fmtTs(s.firstTs) || ago(s.mtime))}</span>
          <span class="tok">${fmtTok(s.tokens.total)} tok</span>
          <span>${s.tasks.total ? '任务 ' + s.tasks.completed + '/' + s.tasks.total : ''}</span>
          <span>${esc(s.sessionId.slice(0, 8))}</span>
          ${s.ephemeral ? '<span class="tag-temp">临时</span>' : ''}
        </div>
      </div>
      <button class="del-btn resume-btn" title="接续该会话开始对话" aria-label="接续对话" style="margin-right:-4px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="del-btn" title="删除该会话" aria-label="删除会话">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>`).join('');
  return note + rows;
}

async function doDeleteSession(dir, sid, projIdx) {
  try {
    const r = await fetch('/api/session/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirName: dir, sessionId: sid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '删除失败');
    toast('会话已移入回收站，可恢复');
    await load(false);
    // reopen the same project drawer if it still exists
    const proj = STATE.projects.find(pp => pp.dirName === dir);
    if (proj && proj.sessions.length) { openDrawer(proj); DRAWER_TAB = 'requirements';
      [...$('#drawer-tabs').children].forEach((c, i) => c.classList.toggle('on', i === 1));
      renderDrawerBody(proj);
    } else closeDrawer();
  } catch (e) { toast('删除失败：' + e.message); }
}

const MEM_META = {
  user: { label: '用户画像 · USER', color: 'var(--mem-user)' },
  feedback: { label: '工作反馈 · FEEDBACK', color: 'var(--mem-feedback)' },
  project: { label: '项目背景 · PROJECT', color: 'var(--mem-project)' },
  reference: { label: '外部引用 · REFERENCE', color: 'var(--mem-reference)' },
};

function viewSkills(p) {
  const local = p.skills || [];
  const global = STATE.globalSkills || [];
  const skillCard = (s, accent) => `
    <div class="mem-item" style="border-left-color:${accent}">
      <div class="mt">${esc(s.name)}</div>
      ${s.description ? `<div class="md">${esc(s.description.length > 220 ? s.description.slice(0, 218) + '…' : s.description)}</div>` : ''}
      <div class="mf">${esc(s.dir)}</div>
    </div>`;

  let html = '';
  html += `<div class="del-note">技能 = Claude 在这个项目里能自动调用的 SKILL.md 能力。本地技能在 <span style="color:var(--ink-dim)">${esc(p.realPath)}/.claude/skills/</span></div>`;

  html += `<div class="mem-group"><h4><span class="swatch" style="background:var(--accent)"></span>项目本地技能 · ${local.length}</h4>`;
  html += local.length ? local.map(s => skillCard(s, 'var(--accent)')).join('')
    : `<div class="md" style="color:var(--ink-faint);font-size:12px">该项目没有本地技能（<code>.claude/skills/</code> 为空或不存在）</div>`;
  html += `</div>`;

  html += `<div class="mem-group"><h4><span class="swatch" style="background:var(--mem-reference)"></span>全局技能 · ${global.length} <span style="color:var(--ink-faint);font-weight:400;text-transform:none;letter-spacing:0">（所有项目可用）</span></h4>`;
  html += global.length ? global.map(s => skillCard(s, 'var(--mem-reference)')).join('')
    : `<div class="md" style="color:var(--ink-faint);font-size:12px">~/.claude/skills/ 为空</div>`;
  html += `</div>`;
  return html;
}

function viewDocs(p) {
  const docs = p.docs || [];
  if (!docs.length) return `<div class="empty">该项目暂无工程文档<br><br>superpowers 等技能会把设计/计划写入 specs/ docs/ plans/</div>`;
  // group by folder
  const groups = {};
  for (const d of docs) (groups[d.folder] || (groups[d.folder] = [])).push(d);
  let html = `<div class="del-note">来自 specs/ docs/ plans/ 的工程文档（设计、计划、todos），点击直接阅读。</div>`;
  for (const folder of Object.keys(groups)) {
    html += `<div class="mem-group"><h4><span class="swatch" style="background:var(--active)"></span>${esc(folder === '.' ? '根目录' : folder)} · ${groups[folder].length}</h4>`;
    html += groups[folder].map(d => `
      <div class="doc-row" data-rel="${esc(d.rel)}" data-cwd="${esc(p.realPath)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--ink-faint)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
        <div style="flex:1;min-width:0"><div class="dt">${esc(d.name)}</div><div class="df">${(d.size/1024).toFixed(1)} KB · ${ago(d.mtime)}</div></div>
      </div>`).join('');
    html += `</div>`;
  }
  return html;
}

function wireDocs(p, body) {
  body.querySelectorAll('.doc-row').forEach(row => {
    row.addEventListener('click', () => openDoc(row.dataset.cwd, row.dataset.rel));
  });
}

let docSeq = 0;
// open a markdown doc as a floating, draggable, resizable window (like a terminal pane)
async function openDoc(cwd, rel) {
  docSeq++;
  const pane = el('div', 'cpane docwin');
  pane.innerHTML = `
    <div class="cpane-head">
      <span class="stat-led ready" style="background:var(--active);box-shadow:0 0 8px var(--active)"></span>
      <span class="pn" title="${esc(rel)}">${esc(rel.split('/').pop())}</span>
      <button class="po" title="独立页面打开">⇱</button>
      <button class="mn" title="收起/展开">–</button>
      <button class="x" title="关闭">×</button>
    </div>
    <div class="docwin-body"><div class="empty">载入中…</div></div>
    <div class="cpane-rz" title="拖动改变大小"></div>`;
  $('#dock').appendChild(pane);
  pane.style.left = Math.max(20, Math.min(innerWidth - 640, 120 + (docSeq % 6) * 32)) + 'px';
  pane.style.top = Math.max(20, Math.min(innerHeight - 280, 70 + (docSeq % 6) * 32)) + 'px';
  bringToFront(pane);

  const body = pane.querySelector('.docwin-body');
  pane.querySelector('.po').onclick = () => window.open(`/doc.html?cwd=${encodeURIComponent(cwd)}&rel=${encodeURIComponent(rel)}`, '_blank');
  pane.querySelector('.mn').onclick = () => toggleMinPane(pane);
  pane.querySelector('.x').onclick = () => { pane.style.opacity = '0'; pane.style.transform = 'translateY(16px)'; setTimeout(() => pane.remove(), 180); };
  makeDraggable(pane, pane.querySelector('.cpane-head'));
  makeResizable(pane, pane.querySelector('.cpane-rz'));
  pane.addEventListener('pointerdown', () => bringToFront(pane), true);

  try {
    const j = await (await fetch(`/api/doc?cwd=${encodeURIComponent(cwd)}&rel=${encodeURIComponent(rel)}`)).json();
    if (!j.ok) throw new Error(j.error);
    body.innerHTML = (typeof marked !== 'undefined')
      ? `<div class="md-body">${marked.parse(j.text)}</div>`
      : `<pre class="md-pre">${esc(j.text)}</pre>`;
    body.scrollTop = 0;
  } catch (e) { body.innerHTML = `<div class="empty">载入失败：${esc(e.message)}</div>`; }
}

function viewMemory(p) {
  const m = p.memory;
  if (!m.total) return `<div class="empty">该项目暂无持久化记忆<br><br>Claude 会在协作中沉淀 4 层记忆到此项目</div>`;

  const legend = `<div class="mem-legend">${['user', 'feedback', 'project', 'reference'].map(k => `
    <div class="mem-lc"><span class="bar" style="background:${MEM_META[k].color}"></span>
      <div class="n" style="color:${MEM_META[k].color}">${m.counts[k]}</div>
      <div class="l">${k}</div></div>`).join('')}</div>`;

  const groups = ['user', 'feedback', 'project', 'reference', 'other'].map(k => {
    const items = m[k] || [];
    if (!items.length) return '';
    const meta = MEM_META[k] || { label: '其他 · OTHER', color: 'var(--ink-dim)' };
    return `<div class="mem-group">
      <h4><span class="swatch" style="background:${meta.color}"></span>${meta.label} · ${items.length}</h4>
      ${items.map(it => `
        <div class="mem-item" style="border-left-color:${meta.color}">
          <div class="mt">${esc(it.name)}</div>
          <div class="md">${esc(it.description || it.body.slice(0, 160))}</div>
          <div class="mf">${esc(it.file)}</div>
        </div>`).join('')}
    </div>`;
  }).join('');

  return legend + groups;
}

// ===========================================================
//  Real terminal panes — the genuine `claude` CLI over WebSocket
//  (JumpServer-style: xterm.js front, node-pty back). 100% CLI.
// ===========================================================
const TERMS = new Map(); // paneId -> ctx
let termSeq = 0;

function wsURL(params) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/term?${params.toString()}`;
}

function stripAnsiText(s) {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b[()][AB012]/g, '');
}

const CONFIRM_RE = /do you want to proceed|would you like to proceed|❯\s*\d\.|\b1\.\s*yes\b|\b2\.\s*no\b|press \d to/i;

function setLed(ctx, state) {
  if (ctx.traffic) ctx.traffic.dataset.state = state;
}

// minimize/restore a floating pane into the shared bottom mindock
function toggleMinPane(pane) {
  if (pane.classList.contains('min')) {
    pane.classList.remove('min');
    $('#dock').appendChild(pane);
    const s = pane._savedPos;
    if (s) { pane.style.left = s.left; pane.style.top = s.top; pane.style.width = s.width; pane.style.height = s.height; }
    bringToFront(pane);
  } else {
    pane._savedPos = { left: pane.style.left, top: pane.style.top, width: pane.style.width, height: pane.style.height };
    pane.style.left = pane.style.top = pane.style.width = pane.style.height = '';
    pane.classList.add('min');
    $('#mindock').appendChild(pane);
  }
}

// apply a state transition: update LED + notify on important transitions
function applyState(ctx, state) {
  if (state === ctx.state) return;
  const prev = ctx.state; ctx.state = state;
  setLed(ctx, state);
  const min = ctx.el.classList.contains('min');
  if (prev === 'busy' && state === 'idle') toast(`「${ctx.project.name}」会话空闲 · 已完成${min ? '（窗口已最小化）' : ''}`);
  else if (state === 'wait') toast(`「${ctx.project.name}」等待你确认${min ? '（窗口已最小化）' : ''}`);
}

// PTY-stream heuristic fallback (used when hooks aren't driving this pane)
function evalStatus(ctx) {
  if (ctx.exited) return;
  if (!ctx.connected) { applyState(ctx, 'off'); return; }
  // if hooks are actively driving this session, trust them and skip the heuristic
  if (ctx.hookDriven && Date.now() - ctx.hookAt < 600000) return;
  const now = Date.now();
  ctx.dataEvents = (ctx.dataEvents || []).filter(e => now - e.t < 1700);
  const recentBytes = ctx.dataEvents.reduce((a, e) => a + e.len, 0);
  const dt = now - ctx.lastData;
  const tail = ctx.recent.slice(-900);
  // Claude's "working" markers: the "esc to interrupt" line + spinner star glyphs (✳✶✻✽…)
  const working = /esc to interrupt/i.test(tail) || /[✳-✽]/.test(ctx.recent.slice(-200));
  let state;
  if (dt < 1700 && (recentBytes > 20 || working)) state = 'busy';
  else if (CONFIRM_RE.test(tail)) state = 'wait';
  else state = 'idle';
  applyState(ctx, state);
}

function openChat(project, resumeSessionId, force) {
  if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
    toast('终端组件 xterm.js 未加载，请检查网络后刷新'); return;
  }
  // one session per project: focus the existing window (or replace it when force = new/resume)
  for (const [pid, c] of TERMS) {
    if (c.project && c.project.realPath === project.realPath) {
      if (force) { closeChat(pid); break; }
      if (c.el.classList.contains('min')) toggleMinPane(c.el);
      bringToFront(c.el);
      try { c.term.focus(); } catch {}
      toast(`「${project.name}」已有会话，已切到该窗口`);
      return;
    }
  }
  const paneId = 'term_' + (++termSeq);
  const pane = el('div', 'cpane term');
  pane.innerHTML = `
    <div class="cpane-head">
      <span class="traffic" data-state="off" title="会话状态：红=进行中 黄=等确认 绿=空闲"><i class="tr-r"></i><i class="tr-y"></i><i class="tr-g"></i></span>
      <span class="pn" title="${esc(project.realPath)}">${esc(project.name)}</span>
      ${project.progress != null ? `<span class="term-prog" title="完成进度">${project.progress}%</span>` : ''}
      <span class="term-tag">${resumeSessionId ? '接续 ' + esc(resumeSessionId.slice(0, 8)) : '新终端'}</span>
      <button class="dc" title="项目文档列表">▤</button>
      <button class="po" title="弹出为独立窗口/页面">⇱</button>
      <button class="nw" title="新终端（不接续历史）">＋</button>
      <button class="mn" title="收起/展开">–</button>
      <button class="x" title="关闭">×</button>
    </div>
    <div class="cpane-term"></div>
    <div class="cpane-sheet">
      <div class="sh-head">文档 · ${(project.docs || []).length}</div>
      <div class="sh-body"></div>
    </div>
    <div class="cpane-rz" title="拖动改变大小"></div>`;
  $('#dock').appendChild(pane);
  // float at a staggered position; draggable + resizable
  const n = TERMS.size;
  pane.style.left = Math.min(innerWidth - 580, 60 + n * 34) + 'px';
  pane.style.top = Math.min(innerHeight - 200, 90 + n * 34) + 'px';
  bringToFront(pane);
  const host = pane.querySelector('.cpane-term');
  const traffic = pane.querySelector('.traffic');

  const term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: 12, lineHeight: 1.15, cursorBlink: true, scrollback: 5000,
    theme: {
      background: '#0a121f', foreground: '#e8f0fb', cursor: '#22d3ee',
      selectionBackground: 'rgba(34,211,238,.3)',
      black: '#0a121f', brightBlack: '#56688a',
      red: '#ff5d73', green: '#34e0a1', yellow: '#ffc857', blue: '#4f8cff',
      magenta: '#9b8cff', cyan: '#22d3ee', white: '#e8f0fb', brightWhite: '#ffffff',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);

  const sid = resumeSessionId || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(16) + Math.floor(performance.now()).toString(16));
  const ctx = { el: pane, term, ws: null, fit, project, traffic, sessionId: sid, connected: false, lastData: 0, recent: '', state: 'idle', exited: false, hookDriven: false, hookAt: 0 };
  TERMS.set(paneId, ctx);

  function connect() {
    const params = new URLSearchParams({ cwd: project.realPath, cols: term.cols, rows: term.rows, sessionId: sid, resume: resumeSessionId ? '1' : '0' });
    const ws = new WebSocket(wsURL(params));
    ctx.ws = ws;
    ws.onopen = () => { ctx.connected = true; evalStatus(ctx); };
    ws.onclose = () => { ctx.connected = false; setLed(ctx, 'off'); };
    ws.onerror = () => { term.write('\r\n\x1b[31m[WebSocket 连接错误]\x1b[0m\r\n'); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'o') {
        term.write(m.d);
        ctx.lastData = Date.now();
        (ctx.dataEvents || (ctx.dataEvents = [])).push({ t: ctx.lastData, len: m.d.length });
        ctx.recent = (ctx.recent + stripAnsiText(m.d)).slice(-3000);
      }
      else if (m.t === 'state') { ctx.hookDriven = true; ctx.hookAt = Date.now(); applyState(ctx, m.state); }  // authoritative hook signal
      else if (m.t === 'exit') { term.write(`\r\n\x1b[33m[claude 已退出 · code ${m.code}]\x1b[0m\r\n`); ctx.exited = true; setLed(ctx, 'off'); }
      else if (m.t === 'err') term.write(`\r\n\x1b[31m[${m.m}]\x1b[0m\r\n`);
    };
    term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d })); });
  }

  setTimeout(() => { try { fit.fit(); } catch {} connect(); }, 40);
  ctx.statusTimer = setInterval(() => evalStatus(ctx), 500);

  const ro = new ResizeObserver(() => {
    try { fit.fit(); } catch {}
    if (ctx.ws && ctx.ws.readyState === 1) ctx.ws.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
  });
  ro.observe(host); ctx.ro = ro;

  pane.querySelector('.po').onclick = () => {
    const params = new URLSearchParams({ cwd: project.realPath, name: project.name, sessionId: ctx.sessionId, resume: '1' });
    closeChat(paneId); // close the embedded PTY first so the session is free to resume
    setTimeout(() => window.open('/terminal.html?' + params.toString(), '_blank', 'width=940,height=640'), 450);
  };
  pane.querySelector('.nw').onclick = () => openChat(project, null, true);
  pane.querySelector('.mn').onclick = () => { toggleMinPane(pane); setTimeout(() => { try { fit.fit(); } catch {} }, 260); };
  pane.querySelector('.x').onclick = () => closeChat(paneId);

  // docs side-sheet
  const sheet = pane.querySelector('.cpane-sheet');
  const shBody = sheet.querySelector('.sh-body');
  const docs = project.docs || [];
  shBody.innerHTML = docs.length
    ? docs.map(d => `<div class="sh-doc" data-rel="${esc(d.rel)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="flex-shrink:0;color:var(--active)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div style="flex:1;min-width:0"><div class="sn">${esc(d.name)}</div><div class="sf">${esc(d.folder === '.' ? '' : d.folder)}</div></div></div>`).join('')
    : `<div class="sh-empty">该项目无 specs/docs/plans 文档</div>`;
  shBody.querySelectorAll('.sh-doc').forEach(r => r.onclick = () => openDoc(project.realPath, r.dataset.rel));
  pane.querySelector('.dc').onclick = () => sheet.classList.toggle('open');

  makeDraggable(pane, pane.querySelector('.cpane-head'));
  makeResizable(pane, pane.querySelector('.cpane-rz'), () => { try { fit.fit(); } catch {} });
  pane.addEventListener('pointerdown', () => bringToFront(pane), true);
  setTimeout(() => term.focus(), 80);
}

let zTop = 90;
function bringToFront(pane) { pane.style.zIndex = String(++zTop); }

function makeDraggable(pane, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // don't drag when hitting a button
    if (pane.classList.contains('min')) { toggleMinPane(pane); return; } // click pill to restore
    e.preventDefault();
    const r = pane.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    pane.classList.add('dragging');
    const move = (ev) => {
      pane.style.left = Math.max(4, Math.min(innerWidth - 80, ev.clientX - ox)) + 'px';
      pane.style.top = Math.max(4, Math.min(innerHeight - 44, ev.clientY - oy)) + 'px';
    };
    const up = () => { pane.classList.remove('dragging'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

function makeResizable(pane, handle, onResize) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = pane.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    pane.classList.add('dragging');
    const move = (ev) => {
      pane.style.width = Math.max(320, sw + (ev.clientX - sx)) + 'px';
      pane.style.height = Math.max(220, sh + (ev.clientY - sy)) + 'px';
      onResize && onResize();
    };
    const up = () => { pane.classList.remove('dragging'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); onResize && onResize(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

function closeChat(paneId) {
  const ctx = TERMS.get(paneId); if (!ctx) return;
  try { clearInterval(ctx.statusTimer); } catch {}
  try { ctx.ro && ctx.ro.disconnect(); } catch {}
  try { ctx.ws && ctx.ws.close(); } catch {}
  try { ctx.term.dispose(); } catch {}
  ctx.el.style.transition = 'opacity .2s, transform .2s';
  ctx.el.style.opacity = '0'; ctx.el.style.transform = 'translateY(20px)';
  setTimeout(() => ctx.el.remove(), 200);
  TERMS.delete(paneId);
}

// ---------- theme toggle (persisted) ----------
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  $('#theme-ico').textContent = theme === 'light' ? '☾' : '☀';
}
let THEME = localStorage.getItem('deck-theme') || 'dark';
applyTheme(THEME);
$('#theme-toggle').onclick = () => {
  THEME = THEME === 'light' ? 'dark' : 'light';
  localStorage.setItem('deck-theme', THEME);
  applyTheme(THEME);
};

// ---------- wiring ----------
$('#refresh').onclick = () => load(false);
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('.chip-filter'); if (!b) return;
  FILTER = b.dataset.f;
  [...$('#filters').children].forEach(c => c.classList.toggle('on', c === b));
  renderGrid();
});

// No auto-refresh: the page stays stable. Data updates only when you click 重新扫描.
load(true);
