'use strict';
/* global Terminal, FitAddon, WebglAddon, SearchAddon, WebLinksAddon, Unicode11Addon, icon, hydrateIcons, applyTheme, THEMES, ACCENTS, TAG_COLORS */

/* =========================================================================
   Helpers
   ========================================================================= */
const $ = (s, r) => (r || document).querySelector(s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(16).slice(2) + Date.now().toString(16));
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  if (a) for (const [k, v] of Object.entries(a)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const basename = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || '';
const shortPath = (p, home) => {
  let s = p || '';
  if (home && s.toLowerCase().startsWith(home.toLowerCase())) s = '~' + s.slice(home.length);
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? '…\\' + parts.slice(-2).join('\\') : s.replace(/\//g, '\\');
};
function relTime(ms) {
  const d = Date.now() - ms, m = 60e3, hr = 36e5, day = 864e5;
  if (d < m) return 'just now';
  if (d < hr) return Math.floor(d / m) + 'm ago';
  if (d < day) return Math.floor(d / hr) + 'h ago';
  if (d < 14 * day) return Math.floor(d / day) + 'd ago';
  return new Date(ms).toLocaleDateString();
}
function hl(text, q) {
  const frag = document.createDocumentFragment();
  const t = String(text);
  if (!q) { frag.append(t); return frag; }
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) { frag.append(t); return frag; }
  frag.append(t.slice(0, i), h('mark', null, t.slice(i, i + q.length)), t.slice(i + q.length));
  return frag;
}
function toast(msg, action, onAction, ms) {
  const t = h('div', { class: 'toast' }, h('span', null, msg));
  if (action) t.append(h('span', { class: 'link', onclick: () => { onAction && onAction(); t.remove(); } }, action));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms || 5000);
}

/* =========================================================================
   State
   ========================================================================= */
const DEFAULT_SETTINGS = {
  theme: 'midnight', accent: 'clay', fontFamily: 'Cascadia Code', fontSize: 14, lineHeight: 1.15,
  scrollback: 10000, cursorStyle: 'bar', cursorBlink: true, shell: 'auto', defaultCwd: '',
  bgTheme: 'none', bgDim: 0.5, bgPause: true, bgAuto: false, bgReact: false, closeToTray: false, lastUpdateCheck: 0, templates: [], claudeArgs: '', autoRestore: 'ask', notify: true, pingSound: true, tgNotifyAll: true, copyOnSelect: false, webgl: true, launchAtLogin: false,
};
let S = null;            // persisted state
let HOME = '';
let SNAPS = {};          // text snapshots of terminal tails (so sleeping tabs are still searchable)
const R = new Map();     // tabId -> runtime { term, fit, search, pane, alive, ... }
let TH = null;           // current theme bundle
let modalDepth = 0;
let dragging = null;

const getTab = (id) => S.tabs.find((t) => t.id === id);
const getFolder = (id) => S.folders.find((f) => f.id === id);
const isAlive = (id) => !!(R.get(id) && R.get(id).alive);

let saveT = null;
function save(now) {
  clearTimeout(saveT);
  const go = () => window.api.saveState({ ...S, closed: S.closed.slice(-15) });
  if (now) return go();
  saveT = setTimeout(go, 180);
}

/* =========================================================================
   Terminals
   ========================================================================= */
function termOptions() {
  const s = S.settings;
  return {
    fontFamily: `"${s.fontFamily}", "Cascadia Mono", Consolas, monospace`, fontSize: s.fontSize, lineHeight: s.lineHeight,
    scrollback: s.scrollback, cursorStyle: s.cursorStyle, cursorBlink: s.cursorBlink, theme: TH.term,
    allowProposedApi: true, allowTransparency: true, smoothScrollDuration: 0, drawBoldTextInBrightColors: false,
    windowsPty: { backend: 'conpty', buildNumber: 26100 }, rightClickSelectsWord: false, scrollOnUserInput: true,
  };
}

function ensureTerm(tab) {
  let rt = R.get(tab.id);
  if (rt) return rt;
  const term = new Terminal(termOptions());
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.api.openExternal(uri)));
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  const pane = h('div', { class: 'term-pane', 'data-id': tab.id });
  $('#termHost').append(pane);
  term.open(pane);
  rt = { term, fit, search, pane, alive: false, exited: false, working: false, unread: false, lastData: 0, lastInput: 0, burstStart: 0, liveTitle: '', titleBusy: false, webgl: null };
  R.set(tab.id, rt);

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const k = ev.key.toLowerCase();
    if (ev.ctrlKey && !ev.altKey) {
      if (k === 'c' && (ev.shiftKey || term.hasSelection())) { if (term.hasSelection()) { window.api.writeClip(term.getSelection()); term.clearSelection(); } return false; }
      if (k === 'v') return false; // let the browser paste event feed xterm (handles bracketed paste)
      if (k === 'tab' || k === 't' || k === 'w' || k === 'k' || k === 'b' || k === 'f' || k === 'h' || k === ',' || /^[1-9]$/.test(k) || k === '=' || k === '+' || k === '-' || k === '0') return false;
    }
    return true;
  });
  term.onData((d) => {
    rt.lastInput = Date.now();
    if (rt.exited) { if (d === '\r') startPty(getTab(tab.id)); return; }
    if (rt.alive) window.api.write(tab.id, d);
  });
  term.onResize(({ cols, rows }) => { rt.quietUntil = Date.now() + 1200; if (rt.alive) window.api.resize(tab.id, cols, rows); });
  term.onTitleChange((t) => {
    const busy = /^[⠀-⣿]/.test(t);
    let clean = t.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (/\.exe$/i.test(clean) || /^[A-Za-z]:\\/.test(clean) || /^(Windows PowerShell|PowerShell)$/i.test(clean)) clean = '';
    if (clean !== rt.liveTitle || busy !== rt.titleBusy) { rt.liveTitle = clean; rt.titleBusy = busy; scheduleRender(); }
  });
  term.onBell(() => { if (S.activeId !== tab.id) { rt.unread = true; scheduleRender(); } });
  term.onSelectionChange(() => { if (S.settings.copyOnSelect && term.hasSelection()) window.api.writeClip(term.getSelection()); });

  pane.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) { window.api.writeClip(term.getSelection()); term.clearSelection(); }
    else { const t = await window.api.readClip(); if (t) term.paste(t); }
  });
  pane.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  pane.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean).map((p) => (/\s/.test(p) ? `"${p}"` : p));
    if (paths.length) { term.paste(paths.join(' ') + ' '); term.focus(); }
  });
  pane.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  return rt;
}

async function startPty(tab) {
  if (!tab) return;
  const rt = ensureTerm(tab);
  rt.exited = false;
  if (S.activeId === tab.id) showPane(tab.id, true); // background resumes must not steal the visible pane
  try { rt.fit.fit(); } catch { /* not laid out yet */ }
  const res = await window.api.spawn({
    id: tab.id, kind: tab.kind, cwd: tab.cwd, sessionId: tab.sessionId, args: tab.args, shell: S.settings.shell,
    cols: rt.term.cols, rows: rt.term.rows, prompt: tab.prompt,
  });
  tab.prompt = null;
  if (!res.ok) {
    rt.term.write(`\x1b[31mFailed to start: ${res.error}\x1b[0m\r\n`);
    rt.exited = true; scheduleRender(); return;
  }
  rt.alive = true; tab.open = true;
  rt.lastData = Date.now();
  rt.quietUntil = Date.now() + (tab.kind === 'claude' ? 5000 : 2500); // startup redraw isn't "work"
  if (tab.kind === 'claude') rt.mode = res.mode;
  save(); scheduleRender();
}

function sleepTab(id, silent) {
  const tab = getTab(id), rt = R.get(id);
  if (!tab) return;
  if (rt) {
    captureSnap(id);
    if (rt.alive) window.api.kill(id);
    try { rt.term.dispose(); } catch { /* ignore */ }
    rt.pane.remove();
    R.delete(id);
  }
  tab.open = false;
  if (S.ui.split === id) S.ui.split = null;
  save();
  if (!silent) scheduleRender();
}

function showPane(id, noFocus) {
  const sp = S.ui.split && S.ui.split !== id && R.get(S.ui.split) && R.get(S.ui.split).alive ? S.ui.split : null;
  for (const [rid, rt] of R) {
    const on = rid === id || rid === sp;
    rt.pane.classList.toggle('show', on);
    rt.pane.classList.toggle('split-l', !!sp && rid === id);
    rt.pane.classList.toggle('split-r', !!sp && rid === sp);
    if (on) {
      if (S.settings.webgl && !rt.webgl) {
        try {
          const w = new WebglAddon.WebglAddon();
          w.onContextLoss(() => { try { w.dispose(); } catch { /* ignore */ } rt.webgl = null; });
          rt.term.loadAddon(w); rt.webgl = w;
        } catch { rt.webgl = null; }
      }
      requestAnimationFrame(() => { try { rt.fit.fit(); } catch { /* ignore */ } if (!noFocus && !modalDepth && rid === id) rt.term.focus(); });
    } else if (rt.webgl) { try { rt.webgl.dispose(); } catch { /* ignore */ } rt.webgl = null; }
  }
}

function fitAll() {
  for (const rt of R.values()) { try { rt.fit.fit(); } catch { /* ignore */ } }
}

function zoom(delta) {
  const s = S.settings;
  s.fontSize = Math.max(9, Math.min(30, delta === 0 ? 14 : s.fontSize + delta));
  applySettingsToTerms();
  save(); scheduleRender();
}

function applySettingsToTerms() {
  const o = termOptions();
  for (const rt of R.values()) {
    for (const k of ['fontFamily', 'fontSize', 'lineHeight', 'scrollback', 'cursorStyle', 'cursorBlink', 'theme']) rt.term.options[k] = o[k];
  }
  requestAnimationFrame(fitAll);
}

/* ---- snapshots (searchable text for sleeping tabs) ---- */
function termText(rt, maxLines) {
  const b = rt.term.buffer.active, lines = [];
  for (let i = Math.max(0, b.length - maxLines); i < b.length; i++) {
    const l = b.getLine(i);
    if (l) lines.push(l.translateToString(true));
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}
function captureSnap(id) {
  const rt = R.get(id);
  if (rt) SNAPS[id] = termText(rt, 400);
}
let snapDirty = '';
function persistSnaps() {
  for (const id of R.keys()) captureSnap(id);
  for (const id of Object.keys(SNAPS)) if (!getTab(id)) delete SNAPS[id];
  const sig = Object.values(SNAPS).reduce((a, s) => a + s.length, 0) + ':' + Object.keys(SNAPS).length;
  if (sig !== snapDirty) { snapDirty = sig; window.api.saveSnaps(SNAPS); }
}

/* ---- pty events ---- */
window.api.onData((id, data) => {
  const rt = R.get(id);
  if (!rt) return;
  rt.term.write(data);
  const now = Date.now();
  if (now - rt.lastInput > 700 && now > (rt.quietUntil || 0)) {
    if (!rt.working) { rt.working = true; rt.burstStart = now; if (!rt.settleAt) rt.taskStart = now; rt.settleAt = 0; scheduleRender(); }
    rt.lastData = now;
  }
});
window.api.onExit((id, code) => {
  const rt = R.get(id), tab = getTab(id);
  if (!rt || !tab) return;
  rt.alive = false; rt.exited = true; rt.working = false; tab.open = false;
  rt.term.write(`\r\n\x1b[2m[process exited${code ? ' with code ' + code : ''} — press Enter to restart]\x1b[0m\r\n`);
  save(); scheduleRender();
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, rt] of R) {
    if (!rt.alive) continue;
    const working = rt.titleBusy || (rt.working && now - rt.lastData < 1800);
    if (working) rt.lastActiveAt = now;
    if (rt.working && !working) {
      // Went quiet. Don't ping yet: Claude pauses between steps, so wait until it has STAYED quiet.
      rt.working = false; changed = true;
      if (!rt.taskStart) rt.taskStart = rt.burstStart || now;
      rt.settleAt = now + SETTLE_MS;
    } else if (!rt.working && rt.titleBusy) {
      rt.working = true; rt.burstStart = now; if (!rt.settleAt) rt.taskStart = now; rt.settleAt = 0; changed = true;
    } else if (!rt.working && rt.settleAt && now >= rt.settleAt) {
      const dur = (rt.lastActiveAt || 0) - rt.taskStart;
      const quietFor = now - (rt.lastActiveAt || 0);
      rt.settleAt = 0; rt.taskStart = 0;
      if (!rt.titleBusy && quietFor >= SETTLE_MS - 1000 && dur >= MIN_TASK_MS) { pingFinished(id); changed = true; }
    }
  }
  if (changed) scheduleRender();
}, 800);

/* ---- "light ping" when a session has finished ALL its work ---- */
const SETTLE_MS = 6000;     // must stay quiet this long (covers pauses between Claude's steps)
const MIN_TASK_MS = 6000;   // ignore trivial blips; ping only after real work
let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    [[880, 0], [1318, 0.12]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.linearRampToValueAtTime(0.045, t + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
      o.connect(g); g.connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.32);
    });
  } catch { /* audio unavailable */ }
}
function pingFinished(id) {
  const tab = getTab(id), rt = R.get(id);
  if (!tab || !rt) return;
  if (id === S.activeId && document.hasFocus()) return; // you're already watching it
  rt.unread = true;                                      // amber dot in the sidebar/strip
  if (S.settings.pingSound !== false) chime();
  if (S.settings.notify && !document.hasFocus()) {
    try {
      const n = new Notification(`${tab.title} finished`, { body: rt.liveTitle || 'All done — waiting for you.', silent: true });
      n.onclick = () => { window.focus(); activate(id); };
    } catch { /* notifications unavailable */ }
    window.api.flash();
  }
  if (typeof window.tgOnFinish === 'function') window.tgOnFinish(id);
}
window.addEventListener('focus', () => { const rt = R.get(S && S.activeId); if (rt && rt.unread) { rt.unread = false; scheduleRender(); } });

/* =========================================================================
   Tab / folder operations
   ========================================================================= */
function createTab(o) {
  const tab = {
    id: uid(), title: o.title || basename(o.cwd) || 'Session', cwd: o.cwd, kind: o.kind || 'claude', folderId: o.folderId || null,
    sessionId: o.sessionId || uid(), args: o.args != null ? o.args : S.settings.claudeArgs, color: null, pinned: false,
    open: false, created: Date.now(), lastActive: Date.now(), prompt: o.prompt || null,
  };
  S.tabs.push(tab);
  if (tab.folderId) { const f = getFolder(tab.folderId); if (f) f.collapsed = false; }
  S.ui.lastCwd = o.cwd;
  activate(tab.id);
  return tab;
}

function activate(id, opts) {
  const tab = getTab(id);
  if (!tab) return;
  S.activeId = id; tab.lastActive = Date.now();
  const rt = R.get(id);
  if (rt) rt.unread = false;
  if (window.applyLook) window.applyLook(tab);
  const resume = !opts || opts.resume !== false;
  if (resume && (!rt || (!rt.alive && !rt.exited))) startPty(tab);
  else showPane(id);
  save(); scheduleRender();
}

function deleteTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  sleepTab(id, true);
  S.tabs = S.tabs.filter((t) => t.id !== id);
  S.closed.push({ ...tab, open: true });
  delete SNAPS[id];
  if (S.activeId === id) {
    const next = S.tabs.filter((t) => isAlive(t.id))[0];
    S.activeId = next ? next.id : null;
    if (next) showPane(next.id);
  }
  save(); scheduleRender();
  toast(`Removed “${tab.title}”`, 'Undo', reopenClosed);
}

function reopenClosed() {
  const t = S.closed.pop();
  if (!t) return toast('Nothing to reopen');
  if (t.folderId && !getFolder(t.folderId)) t.folderId = null;
  S.tabs.push(t);
  activate(t.id);
}

function liveTabs() { return S.tabs.filter((t) => isAlive(t.id)); }

function cycle(dir) {
  const live = liveTabs();
  if (!live.length) return;
  const i = live.findIndex((t) => t.id === S.activeId);
  activate(live[(i + dir + live.length) % live.length].id);
}

function newFolder(parentId, name) {
  const f = { id: uid(), name: name || 'New folder', parentId: parentId || null, color: null, collapsed: false };
  S.folders.push(f);
  save(); scheduleRender();
  return f;
}

function folderDescendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of S.folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; } }
  return out;
}

function deleteFolder(id) {
  const f = getFolder(id);
  if (!f) return;
  for (const t of S.tabs) if (t.folderId === id) t.folderId = f.parentId;
  for (const c of S.folders) if (c.parentId === id) c.parentId = f.parentId;
  S.folders = S.folders.filter((x) => x.id !== id);
  save(); scheduleRender();
}

function moveTab(tabId, folderId, targetId, after, pinned) {
  const t = getTab(tabId);
  if (!t || tabId === targetId) return;
  S.tabs = S.tabs.filter((x) => x.id !== tabId);
  t.folderId = folderId || null;
  t.pinned = !!pinned;
  const ti = targetId ? S.tabs.findIndex((x) => x.id === targetId) : -1;
  if (ti >= 0) S.tabs.splice(ti + (after ? 1 : 0), 0, t); else S.tabs.push(t);
  if (folderId) { const f = getFolder(folderId); if (f) f.collapsed = false; }
  save(); scheduleRender();
}

function moveFolder(id, parentId, beforeId) {
  const f = getFolder(id);
  if (!f || (parentId && folderDescendants(id).has(parentId)) || id === beforeId) return;
  S.folders = S.folders.filter((x) => x.id !== id);
  f.parentId = parentId || null;
  const bi = beforeId ? S.folders.findIndex((x) => x.id === beforeId) : -1;
  if (bi >= 0) S.folders.splice(bi, 0, f); else S.folders.push(f);
  if (parentId) { const p = getFolder(parentId); if (p) p.collapsed = false; }
  save(); scheduleRender();
}

function folderTabs(id, recursive) {
  const ids = recursive ? folderDescendants(id) : new Set([id]);
  return S.tabs.filter((t) => ids.has(t.folderId));
}

function folderPath(folderId) {
  const names = [];
  let f = getFolder(folderId), guard = 0;
  while (f && guard++ < 20) { names.unshift(f.name); f = getFolder(f.parentId); }
  return names;
}

/* =========================================================================
   Rendering
   ========================================================================= */
let renderQueued = false, lastRender = 0;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const wait = Math.max(0, 120 - (performance.now() - lastRender));
  setTimeout(() => requestAnimationFrame(() => { renderQueued = false; if (dragging) { scheduleRender(); return; } lastRender = performance.now(); renderAll(); }), wait);
}

function statusOf(tab) {
  const rt = R.get(tab.id);
  if (!rt) return 'sleep';
  if (rt.exited) return 'exit';
  if (!rt.alive) return 'sleep';
  if (rt.needs) return 'attn';
  if (rt.unread) return 'unread';
  if (rt.working) return 'work';
  return 'idle';
}
const STATUS_TEXT = { sleep: 'Asleep — click to resume', idle: 'Ready', work: 'Working…', unread: 'Finished — needs you', attn: 'Waiting for your answer', exit: 'Process exited' };

function renderAll() {
  renderTree(); renderStrip(); renderCrumb(); renderStatus(); renderMainState();
  if (window.extrasRender) window.extrasRender();
  const hasRestorable = S.tabs.some((t) => !isAlive(t.id));
  $('#btnResumeAll').classList.toggle('hidden', !hasRestorable);
  document.title = (S.activeId && getTab(S.activeId) ? getTab(S.activeId).title + ' — ' : '') + 'Claude Deck';
}

function renderMainState() {
  const tab = getTab(S.activeId);
  const showTerm = tab && R.get(tab.id);
  $('#empty').classList.toggle('hidden', !!tab);
  let card = $('#sleepCard');
  if (tab && !showTerm) {
    if (!card) { card = h('div', { id: 'sleepCard', style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center' }); $('#termHost').append(card); }
    card.replaceChildren(h('div', { class: 'empty-card' },
      h('div', { class: 'logo-big', html: icon('moon', 44) }),
      h('h1', null, tab.title),
      h('p', null, tab.kind === 'claude' ? 'This Claude session is asleep. Resuming picks up the exact conversation.' : 'This terminal is asleep.', h('br'), h('span', { style: 'color:var(--faint);font-family:var(--mono);font-size:12px' }, tab.cwd)),
      h('div', { class: 'empty-actions' }, h('button', { class: 'btn primary', onclick: () => activate(tab.id) }, h('span', { html: icon('play') }), 'Resume session'))));
  } else if (card) card.remove();
}

function dotEl(st) { return h('span', { class: 'dot ' + st, title: STATUS_TEXT[st] }); }

function tabRow(tab, depth, q) {
  const st = statusOf(tab), rt = R.get(tab.id);
  const sub = (rt && rt.liveTitle) || shortPath(tab.cwd, HOME);
  const row = h('div', { class: 'row tab-row' + (tab.id === S.activeId ? ' active' : '') + (st === 'sleep' ? ' sleeping' : ''), draggable: 'true', 'data-tab': tab.id, style: `padding-left:${9 + depth * 14}px` },
    tab.color && h('span', { class: 'tag', style: `background:${tab.color}` }),
    dotEl(st),
    h('div', { class: 'two' },
      h('div', { class: 'name' }, tab.kind === 'shell' && h('span', { class: 'ttype', html: icon('terminal', 12) + ' ' }), hl(tab.title, q)),
      h('div', { class: 'sub' }, hl(sub, q)), window.ctxBar ? window.ctxBar(tab) : null),
    h('div', { class: 'actions' },
      st === 'sleep' || st === 'exit'
        ? h('button', { class: 'icon-btn', title: 'Resume', html: icon('play', 14), onclick: (e) => { e.stopPropagation(); activate(tab.id); } })
        : h('button', { class: 'icon-btn', title: 'Put to sleep (keeps the session, frees memory)', html: icon('moon', 14), onclick: (e) => { e.stopPropagation(); requestSleep(tab.id); } }),
      h('button', { class: 'icon-btn', title: 'More', html: icon('more', 14), onclick: (e) => { e.stopPropagation(); tabMenu(tab, e.clientX, e.clientY); } })));
  row.addEventListener('click', () => activate(tab.id));
  row.addEventListener('dblclick', () => renameTab(tab.id));
  row.addEventListener('auxclick', (e) => { if (e.button === 1) requestSleep(tab.id); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(tab, e.clientX, e.clientY); });
  bindDrag(row, { type: 'tab', id: tab.id });
  row.addEventListener('dragover', (e) => {
    if (!dragging || dragging.type !== 'tab' || dragging.id === tab.id) return;
    e.preventDefault(); e.stopPropagation();
    const after = e.offsetY > row.clientHeight / 2;
    clearDropMarks(); row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  row.addEventListener('drop', (e) => {
    if (!dragging || dragging.type !== 'tab') return;
    e.preventDefault(); e.stopPropagation();
    const after = e.offsetY > row.clientHeight / 2, d = dragging; dragEnd();
    moveTab(d.id, tab.folderId, tab.id, after, tab.pinned);
  });
  return row;
}

function folderRow(f, depth, q, forceOpen) {
  const open = forceOpen || !f.collapsed;
  const count = folderTabs(f.id, true).length;
  const row = h('div', { class: 'row folder', draggable: 'true', style: `padding-left:${6 + depth * 14}px` },
    h('span', { class: 'chev' + (open ? ' open' : ''), html: icon('chevron', 14) }),
    h('span', { style: f.color ? `color:${f.color}` : 'color:var(--dim)', html: icon(open ? 'folderOpen' : 'folder', 16) }),
    h('span', { class: 'name' }, hl(f.name, q)),
    h('span', { class: 'count' }, count || ''),
    h('div', { class: 'actions' },
      h('button', { class: 'icon-btn', title: 'New session in this folder', html: icon('plus', 14), onclick: (e) => { e.stopPropagation(); newSessionModal({ folderId: f.id }); } }),
      h('button', { class: 'icon-btn', title: 'More', html: icon('more', 14), onclick: (e) => { e.stopPropagation(); folderMenu(f, e.clientX, e.clientY); } })));
  row.addEventListener('click', () => { f.collapsed = !f.collapsed; save(); scheduleRender(); });
  row.addEventListener('dblclick', (e) => { e.stopPropagation(); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(f, e.clientX, e.clientY); });
  bindDrag(row, { type: 'folder', id: f.id });
  row.addEventListener('dragover', (e) => {
    if (!dragging) return;
    if (dragging.type === 'folder' && folderDescendants(dragging.id).has(f.id)) return;
    e.preventDefault(); e.stopPropagation();
    clearDropMarks();
    if (dragging.type === 'folder' && e.offsetY < row.clientHeight * 0.25) row.classList.add('drop-before'); else row.classList.add('drop-in');
  });
  row.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    const before = dragging.type === 'folder' && e.offsetY < row.clientHeight * 0.25, d = dragging; dragEnd();
    if (d.type === 'tab') moveTab(d.id, f.id, null, false, false);
    else if (before) moveFolder(d.id, f.parentId, f.id);
    else moveFolder(d.id, f.id, null);
  });
  return row;
}

function renderTree() {
  const tree = $('#tree'), q = $('#filter').value.trim().toLowerCase();
  const scroll = tree.scrollTop;
  const frag = document.createDocumentFragment();
  const match = (t) => !q || `${t.title} ${t.cwd} ${(R.get(t.id) || {}).liveTitle || ''}`.toLowerCase().includes(q);
  const folderMatches = (f) => f.name.toLowerCase().includes(q) || folderTabs(f.id, true).some(match);

  const pinned = S.tabs.filter((t) => t.pinned && match(t));
  if (pinned.length) {
    frag.append(h('div', { class: 'sec-label', html: icon('pin', 11) + ' Pinned' }));
    pinned.forEach((t) => frag.append(tabRow(t, 0, q)));
  }
  let shown = 0;
  const walk = (parentId, depth) => {
    for (const f of S.folders.filter((x) => x.parentId === parentId)) {
      if (q && !folderMatches(f)) continue;
      shown++;
      frag.append(folderRow(f, depth, q, !!q));
      if (q || !f.collapsed) {
        walk(f.id, depth + 1);
        const own = S.tabs.filter((t) => t.folderId === f.id && !t.pinned && (match(t) || f.name.toLowerCase().includes(q)));
        own.forEach((t) => { shown++; frag.append(tabRow(t, depth + 1, q)); });
        if (!q && !own.length && !S.folders.some((x) => x.parentId === f.id)) frag.append(h('div', { class: 'empty-hint', style: `padding:6px 10px 6px ${34 + depth * 14}px;text-align:left;font-size:12px` }, 'Empty — drag sessions here'));
      }
    }
  };
  walk(null, 0);
  const rootTabs = S.tabs.filter((t) => !t.folderId && !t.pinned && match(t));
  if (rootTabs.length && S.folders.length && !q) frag.append(h('div', { class: 'sec-label' }, 'Unsorted'));
  rootTabs.forEach((t) => { shown++; frag.append(tabRow(t, 0, q)); });
  if (!shown && !pinned.length) frag.append(h('div', { class: 'empty-hint' }, q ? 'No sessions match.' : 'No sessions yet.\nCreate one with “New session”.'));
  tree.replaceChildren(frag);
  tree.scrollTop = scroll;
}

function renderStrip() {
  const wrap = $('#stripTabs');
  wrap.replaceChildren(...liveTabs().map((t) => {
    const st = statusOf(t);
    const el = h('div', { class: 'stab' + (t.id === S.activeId ? ' active' : ''), title: t.title + '\n' + t.cwd },
      dotEl(st), h('span', { class: 'name' }, t.title),
      h('button', { class: 'x', title: 'Sleep (Ctrl+W)', html: icon('x', 12), onclick: (e) => { e.stopPropagation(); requestSleep(t.id); } }));
    el.addEventListener('click', () => activate(t.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) requestSleep(t.id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
    return el;
  }));
  const act = wrap.querySelector('.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderCrumb() {
  const c = $('#crumb'), tab = getTab(S.activeId);
  c.replaceChildren();
  if (!tab) return;
  const parts = folderPath(tab.folderId);
  parts.forEach((p) => c.append(h('span', null, p), h('span', { class: 'sep' }, '›')));
  c.append(h('b', null, tab.title));
}

function renderStatus() {
  const sb = $('#statusbar'), tab = getTab(S.activeId);
  const live = liveTabs().length;
  sb.replaceChildren();
  if (tab) {
    const st = statusOf(tab);
    sb.append(h('span', { class: 'chip' }, dotEl(st), STATUS_TEXT[st] === 'Asleep — click to resume' ? 'Asleep' : STATUS_TEXT[st]),
      h('span', { class: 'chip click', title: 'Open folder in Explorer', onclick: () => window.api.openPath(tab.cwd) }, h('span', { html: icon('folder', 13) }), shortPath(tab.cwd, HOME)));
    if (tab.kind === 'claude' && window.ctxChip) { const c = window.ctxChip(tab); if (c) sb.append(c); }
    if (tab.kind === 'claude') sb.append(h('span', { class: 'chip click', title: 'Click to copy session id — resume manually with: claude --resume ' + tab.sessionId, onclick: () => { window.api.writeClip(tab.sessionId); toast('Session id copied'); } },
      h('span', { html: icon('copy', 13) }), tab.sessionId.slice(0, 8)));
  } else sb.append(h('span', null, 'Ready'));
  sb.append(h('span', { class: 'sp' }), h('span', null, `${live} live · ${S.tabs.length} total`), h('span', { class: 'click', onclick: () => zoom(0), title: 'Ctrl +/- to zoom, Ctrl 0 to reset' }, S.settings.fontSize + 'px'));
}

/* ---- drag helpers ---- */
function bindDrag(el, payload) {
  el.addEventListener('dragstart', (e) => { dragging = payload; e.dataTransfer.setData('text/plain', payload.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => el.classList.add('dragging'), 0); });
  el.addEventListener('dragend', dragEnd);
}
function clearDropMarks() { document.querySelectorAll('.drop-in,.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-in', 'drop-before', 'drop-after')); }
function dragEnd() { dragging = null; clearDropMarks(); document.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging')); scheduleRender(); }

/* =========================================================================
   Context menus
   ========================================================================= */
function showMenu(items, x, y) {
  const m = $('#ctx');
  m.replaceChildren();
  for (const it of items) {
    if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
    if (it.swatches) {
      m.append(h('div', { class: 'swatches' }, [null, ...TAG_COLORS].map((c) => h('span', { class: 'swatch' + (it.current === c ? ' on' : ''), style: `background:${c || 'var(--bg3)'}`, title: c ? '' : 'No color', onclick: () => { hideMenu(); it.pick(c); } }))));
      continue;
    }
    m.append(h('div', { class: 'mi' + (it.danger ? ' danger' : ''), onclick: () => { hideMenu(); it.run(); } },
      h('span', { html: icon(it.icon || 'check', 15), style: it.icon ? '' : 'visibility:hidden' }), it.label, it.key && h('span', { class: 'k' }, it.key)));
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
}
function hideMenu() { $('#ctx').classList.add('hidden'); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);

function tabMenu(tab, x, y) {
  const alive = isAlive(tab.id);
  showMenu([
    alive ? { label: 'Put to sleep', icon: 'moon', key: 'Ctrl W', run: () => requestSleep(tab.id) } : { label: 'Resume session', icon: 'play', run: () => activate(tab.id) },
    { label: 'Rename', icon: 'edit', run: () => renameTab(tab.id) },
    { label: 'Edit details…', icon: 'gear', run: () => newSessionModal({ edit: tab.id }) },
    { label: tab.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => { tab.pinned = !tab.pinned; save(); scheduleRender(); } },
    { label: 'Move to folder…', icon: 'move', run: async () => { const f = await folderPicker('Move session to'); if (f !== undefined) moveTab(tab.id, f, null, false, false); } },
    '-',
    { swatches: true, current: tab.color, pick: (c) => { tab.color = c; save(); scheduleRender(); } },
    '-',
    { label: 'Duplicate (new conversation)', icon: 'copy', run: () => createTab({ title: tab.title + ' 2', cwd: tab.cwd, kind: tab.kind, folderId: tab.folderId, args: tab.args }) },
    ...(tab.kind === 'claude' ? [{ label: 'Copy session id', icon: 'link', run: () => { window.api.writeClip(tab.sessionId); toast('Session id copied'); } }] : []),
    ...(tab.id !== S.activeId ? [{ label: 'Open beside current (split)', icon: 'sidebar', run: () => window.extras.splitWith(tab.id) }] : []),
    ...(S.ui.split ? [{ label: 'Close split view', icon: 'x', run: () => window.extras.closeSplit() }] : []),
    ...(tab.kind === 'claude' ? [{ label: 'Export transcript (.md)…', icon: 'copy', run: () => window.extras.exportTab(tab) }] : []),
    { label: 'Open folder in Explorer', icon: 'open', run: () => window.api.openPath(tab.cwd) },
    '-',
    { label: 'Remove session', icon: 'trash', danger: true, run: () => deleteTab(tab.id) },
  ], x, y);
}

function folderMenu(f, x, y) {
  const tabs = folderTabs(f.id, true);
  showMenu([
    { label: 'New session here', icon: 'plus', run: () => newSessionModal({ folderId: f.id }) },
    { label: 'New subfolder', icon: 'folderPlus', run: async () => { const n = await promptModal('New subfolder', '', 'Folder name'); if (n) newFolder(f.id, n); } },
    { label: 'Rename', icon: 'edit', run: async () => { const n = await promptModal('Rename folder', f.name); if (n) { f.name = n; save(); scheduleRender(); } } },
    { label: 'Move to folder…', icon: 'move', run: async () => { const p = await folderPicker('Move folder into', f.id); if (p !== undefined) moveFolder(f.id, p, null); } },
    '-',
    { swatches: true, current: f.color, pick: (c) => { f.color = c; save(); scheduleRender(); } },
    { label: 'Wallpaper & accent…', icon: 'palette', run: () => window.extras.lookModal(f) },
    '-',
    { label: `Resume all (${tabs.filter((t) => !isAlive(t.id)).length})`, icon: 'play', run: () => resumeMany(tabs.filter((t) => !isAlive(t.id)).map((t) => t.id)) },
    { label: 'Put all to sleep', icon: 'moon', run: () => tabs.forEach((t) => sleepTab(t.id)) },
    '-',
    { label: 'Delete folder (keeps sessions)', icon: 'trash', danger: true, run: () => deleteFolder(f.id) },
  ], x, y);
}

async function requestSleep(id) {
  const rt = R.get(id), tab = getTab(id);
  if (!tab) return;
  if (rt && rt.alive && rt.working) {
    const ok = await confirmModal('Session is still working', `“${tab.title}” looks busy. Putting it to sleep stops the running process, but you can resume the conversation later.`, 'Sleep anyway');
    if (!ok) return;
  }
  sleepTab(id);
  if (S.activeId === id) { const n = liveTabs()[0]; if (n) activate(n.id); else { save(); scheduleRender(); } }
}

async function renameTab(id) {
  const tab = getTab(id);
  const n = await promptModal('Rename session', tab.title);
  if (n) { tab.title = n; save(); scheduleRender(); }
}

function resumeMany(ids) {
  ids.forEach((id, i) => setTimeout(() => { const t = getTab(id); if (t && !isAlive(id)) { if (i === 0 || !S.activeId) activate(id); else startPty(t); } }, i * 350));
}

/* =========================================================================
   Modals
   ========================================================================= */
function openModal({ title, body, foot, wide, bare, onClose, align }) {
  modalDepth++;
  const root = $('#modalRoot');
  const m = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    !bare && h('div', { class: 'm-head' }, h('h2', null, title), h('button', { class: 'icon-btn', html: icon('x'), onclick: () => close() })),
    h('div', bare ? { style: 'display:flex;flex-direction:column;min-height:0' } : { class: 'm-body' }, body),
    foot && h('div', { class: 'm-foot' }, foot.map((b) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => b.run(close) }, b.label))));
  const bd = h('div', { class: 'backdrop', style: align === 'top' ? 'padding-top:8vh' : '' }, m);
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close(val) {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    bd.remove(); modalDepth--;
    onClose && onClose(val);
    const rt = R.get(S.activeId); if (rt && !modalDepth) rt.term.focus();
  }
  document.addEventListener('keydown', onKey, true);
  root.append(bd);
  return { close, el: m };
}

function promptModal(title, value, placeholder) {
  return new Promise((res) => {
    const inp = h('input', { class: 'inp', value: value || '', placeholder: placeholder || '', spellcheck: 'false' });
    let done = false;
    const finish = (close, v) => { done = true; close(); res(v); };
    const m = openModal({ title, body: inp, onClose: () => { if (!done) res(null); }, foot: [
      { label: 'Cancel', run: (c) => finish(c, null) },
      { label: 'Save', primary: true, run: (c) => finish(c, inp.value.trim() || null) }] });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; m.close(); res(inp.value.trim() || null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

function confirmModal(title, msg, okLabel, danger) {
  return new Promise((res) => {
    let done = false;
    openModal({ title, body: h('p', { style: 'margin:4px 0 6px;color:var(--dim);line-height:1.55' }, msg), onClose: () => { if (!done) res(false); }, foot: [
      { label: 'Cancel', run: (c) => { done = true; c(); res(false); } },
      { label: okLabel || 'OK', primary: !danger, danger, run: (c) => { done = true; c(); res(true); } }] });
  });
}

// resolves to folderId, null (top level) or undefined (cancelled)
function folderPicker(title, excludeId) {
  return new Promise((res) => {
    let done = false;
    const ex = excludeId ? folderDescendants(excludeId) : new Set();
    const list = h('div', { class: 'tree-pick' });
    const m = openModal({ title, body: list, onClose: () => { if (!done) res(undefined); } });
    const pick = (v) => { done = true; m.close(); res(v); };
    list.append(h('div', { class: 'pal-item', onclick: () => pick(null) }, h('span', { html: icon('folder') }), h('div', { class: 't' }, 'Top level')));
    const walk = (pid, d) => S.folders.filter((f) => f.parentId === pid && !ex.has(f.id)).forEach((f) => {
      list.append(h('div', { class: 'pal-item', style: `padding-left:${10 + d * 18}px`, onclick: () => pick(f.id) }, h('span', { style: f.color ? `color:${f.color}` : '', html: icon('folder') }), h('div', { class: 't' }, f.name)));
      walk(f.id, d + 1);
    });
    walk(null, 0);
    list.append(h('div', { class: 'pal-item', onclick: async () => { const n = await promptModal('New folder', '', 'Folder name'); if (n) { const f = newFolder(null, n); pick(f.id); } } }, h('span', { html: icon('folderPlus') }), h('div', { class: 't' }, 'New folder…')));
  });
}

/* ---- new / edit session ---- */
function folderOptions(sel) {
  const opts = [h('option', { value: '' }, 'Unsorted (top level)')];
  const walk = (pid, d) => S.folders.filter((f) => f.parentId === pid).forEach((f) => {
    opts.push(h('option', { value: f.id, selected: f.id === sel }, ' '.repeat(d) + f.name)); walk(f.id, d + 1);
  });
  walk(null, 0);
  return opts;
}

function newSessionModal(o) {
  o = o || {};
  const editing = o.edit ? getTab(o.edit) : null;
  let kind = editing ? editing.kind : 'claude';
  const dir = h('input', { class: 'inp', value: editing ? editing.cwd : (S.ui.lastCwd || S.settings.defaultCwd || HOME), spellcheck: 'false' });
  const name = h('input', { class: 'inp', value: editing ? editing.title : '', placeholder: 'Defaults to the folder name', spellcheck: 'false' });
  const args = h('input', { class: 'inp', value: editing ? (editing.args || '') : S.settings.claudeArgs, placeholder: 'e.g. --model opus', spellcheck: 'false' });
  const folder = h('select', { class: 'inp' }, folderOptions(editing ? editing.folderId : o.folderId));
  const dirHint = h('div', { class: 'hint' });
  const prompt = h('textarea', { class: 'inp', rows: 2, style: 'height:auto;padding:8px 11px;resize:none', placeholder: 'Sent to Claude when the session starts, e.g. "Read CLAUDE.md and summarise the open TODOs"', spellcheck: 'false' });
  const promptField = h('div', { class: 'field' }, h('label', null, 'Opening prompt (optional)'), prompt);
  const tpls = S.settings.templates || [];
  const tplSel = h('select', { class: 'inp' }, [h('option', { value: '' }, tpls.length ? 'Start from a template…' : 'No templates yet — fill in the form and press “Save as template”'), ...tpls.map((t) => h('option', { value: t.id }, t.name))]);
  const argsField = h('div', { class: 'field' }, h('label', null, 'Extra Claude flags (optional)'), args);
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => {
    seg.replaceChildren(
      h('button', { class: kind === 'claude' ? 'on' : '', onclick: () => { if (editing) return; kind = 'claude'; drawSeg(); } }, h('span', { html: icon('sparkle', 14) }), 'Claude Code'),
      h('button', { class: kind === 'shell' ? 'on' : '', onclick: () => { if (editing) return; kind = 'shell'; drawSeg(); } }, h('span', { html: icon('terminal', 14) }), 'Terminal'));
    argsField.classList.toggle('hidden', kind !== 'claude');
  };
  drawSeg();
  tplSel.onchange = () => {
    const t = tpls.find((x) => x.id === tplSel.value); if (!t) return;
    kind = t.kind || 'claude'; drawSeg(); dir.value = t.cwd || dir.value; name.value = t.name; args.value = t.args || ''; prompt.value = t.prompt || '';
    if (t.folderId && getFolder(t.folderId)) folder.value = t.folderId; check();
  };
  const recents = [...new Set(S.tabs.slice().sort((a, b) => b.lastActive - a.lastActive).map((t) => t.cwd))].slice(0, 6);
  const chips = h('div', { class: 'chips' }, recents.map((p) => h('button', { class: 'chip-btn', title: p, onclick: () => { dir.value = p; dir.dispatchEvent(new Event('input')); } }, basename(p) || p)));
  const check = async () => { const ok = await window.api.isDir(dir.value.trim()); dirHint.textContent = ok ? '' : 'Folder not found'; dirHint.style.color = ok ? '' : 'var(--err)'; return ok; };
  dir.addEventListener('input', check);

  const submit = async (close) => {
    const cwd = dir.value.trim();
    if (!(await check())) { dir.focus(); return; }
    const folderId = folder.value || null;
    if (editing) {
      const cwdChanged = cwd.toLowerCase() !== editing.cwd.toLowerCase();
      editing.title = name.value.trim() || basename(cwd);
      editing.folderId = folderId; editing.args = args.value.trim();
      if (cwdChanged) { editing.cwd = cwd; if (editing.kind === 'claude') editing.sessionId = uid(); toast('Directory changed — next resume starts a fresh conversation'); }
      close(); save(); scheduleRender(); return;
    }
    close();
    createTab({ title: name.value.trim(), cwd, kind, folderId, args: args.value.trim(), prompt: kind === 'claude' ? prompt.value.trim() : '' });
  };

  const body = h('div', null,
    !editing && tpls.length ? h('div', { class: 'field' }, tplSel) : null,
    !editing && h('div', { class: 'field' }, seg),
    h('div', { class: 'field' }, h('label', null, 'Working directory'),
      h('div', { class: 'inline' }, dir, h('button', { class: 'btn', onclick: async () => { const p = await window.api.pickDir(dir.value); if (p) { dir.value = p; check(); } } }, 'Browse…')),
      dirHint, !editing && recents.length ? chips : null),
    h('div', { class: 'field' }, h('label', null, 'Name'), name),
    h('div', { class: 'field' }, h('label', null, 'Folder'), folder),
    argsField, editing ? null : promptField,
    editing && editing.kind === 'claude' ? h('div', { class: 'hint' }, 'Session id: ' + editing.sessionId) : null);
  const m = openModal({ title: editing ? 'Edit session' : 'New session', body, foot: [
    ...(editing ? [] : [{ label: 'Save as template', run: () => {
      const nm = name.value.trim() || basename(dir.value.trim()) || 'Template';
      S.settings.templates = [...(S.settings.templates || []).filter((x) => x.name !== nm), { id: uid(), name: nm, kind, cwd: dir.value.trim(), args: args.value.trim(), prompt: prompt.value.trim(), folderId: folder.value || null }];
      save(); toast('Template “' + nm + '” saved — pick it from the dropdown next time');
    } }]),
    { label: 'Cancel', run: (c) => c() }, { label: editing ? 'Save' : 'Create session', primary: true, run: submit }] });
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); submit(m.close); } });
  setTimeout(() => (editing ? name : dir).focus(), 30);
}

/* ---- restore ("welcome back") ---- */
function restoreModal(tabs, preselect) {
  if (!tabs.length) return toast('Nothing to resume — every session is already running.');
  const sel = new Set(preselect ? tabs.filter((t) => t.open).map((t) => t.id) : tabs.map((t) => t.id));
  const list = h('div', { class: 'restore-list' });
  const draw = () => list.replaceChildren(...tabs.map((t) => h('div', { class: 'restore-item', onclick: () => { sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); draw(); } },
    h('span', { class: 'check' + (sel.has(t.id) ? ' on' : ''), html: icon('check', 13) }),
    h('div', { class: 't' }, h('div', null, t.title), h('div', { class: 't2' }, [...folderPath(t.folderId), shortPath(t.cwd, HOME)].filter(Boolean).join('  ›  '))),
    h('span', { style: 'color:var(--faint);font-size:11.5px' }, relTime(t.lastActive)))));
  draw();
  const body = h('div', null,
    h('p', { style: 'margin:2px 0 8px;color:var(--dim);line-height:1.5' }, 'These sessions were open last time. Each one resumes its exact Claude conversation (claude --resume).'), list);
  openModal({ title: preselect ? 'Welcome back — pick up where you left off' : 'Resume sessions', body, wide: true, onClose: () => {}, foot: [
    { label: 'Select all', run: () => { tabs.forEach((t) => sel.add(t.id)); draw(); } },
    { label: 'Not now', run: (c) => { if (preselect) tabs.forEach((t) => { t.open = false; }); save(); c(); } },
    { label: 'Resume selected', primary: true, run: (c) => { const ids = tabs.filter((t) => sel.has(t.id)).map((t) => t.id); tabs.forEach((t) => { if (!sel.has(t.id)) t.open = false; }); c(); resumeMany(ids); } }] });
}

/* ---- history (past Claude sessions) ---- */
async function historyModal() {
  const list = h('div', { class: 'pal-list', style: 'max-height:58vh' }, h('div', { class: 'pal-empty' }, 'Scanning ~/.claude/projects …'));
  const inp = h('input', { placeholder: 'Search past Claude conversations…', spellcheck: 'false' });
  const body = h('div', { style: 'display:flex;flex-direction:column;min-height:0' }, h('div', { class: 'pal-input' }, h('span', { html: icon('history') }), inp), list);
  const m = openModal({ bare: true, wide: true, body, align: 'top' });
  let items = [];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const rows = items.filter((s) => !q || (s.title + ' ' + s.cwd).toLowerCase().includes(q)).slice(0, 120);
    if (!rows.length) return list.replaceChildren(h('div', { class: 'pal-empty' }, items.length ? 'No matches' : 'No past Claude sessions found.'));
    list.replaceChildren(...rows.map((s) => {
      const open = S.tabs.find((t) => t.sessionId === s.id);
      return h('div', { class: 'pal-item', onclick: () => {
        m.close();
        if (open) return activate(open.id);
        createTab({ title: s.title.slice(0, 42), cwd: s.cwd, kind: 'claude', sessionId: s.id });
      } },
      h('span', { style: 'color:var(--accent)', html: icon('sparkle') }),
      h('div', { class: 't' }, h('div', { class: 't1' }, hl(s.title, q)), h('div', { class: 't2' }, shortPath(s.cwd, HOME))),
      h('span', { class: 'meta' }, open ? 'already open · ' : '', relTime(s.mtime)));
    }));
  };
  inp.addEventListener('input', draw);
  setTimeout(() => inp.focus(), 30);
  items = await window.api.listSessions();
  draw();
}

/* ---- command palette & global search ---- */
function paletteModal() {
  const inp = h('input', { placeholder: 'Search sessions, folders, and terminal output…', spellcheck: 'false' });
  const list = h('div', { class: 'pal-list' });
  const body = h('div', { style: 'display:flex;flex-direction:column;min-height:0' }, h('div', { class: 'pal-input' }, h('span', { html: icon('search') }), inp, h('kbd', null, 'Esc')), list);
  const m = openModal({ bare: true, body, align: 'top' });
  let results = [], sel = 0;

  const actions = [
    { t: 'New session', i: 'plus', k: 'Ctrl T', run: () => newSessionModal() },
    { t: 'New folder', i: 'folderPlus', k: 'Ctrl Shift N', run: async () => { const n = await promptModal('New folder', '', 'Folder name'); if (n) newFolder(null, n); } },
    { t: 'Browse past Claude sessions', i: 'history', k: 'Ctrl H', run: historyModal },
    { t: 'Resume sessions…', i: 'play', run: () => restoreModal(S.tabs.filter((t) => !isAlive(t.id)), false) },
    { t: 'Reopen last removed session', i: 'history', k: 'Ctrl Shift T', run: reopenClosed },
    { t: 'Toggle sidebar', i: 'sidebar', k: 'Ctrl B', run: toggleSidebar },
    { t: 'Settings', i: 'gear', k: 'Ctrl ,', run: settingsModal },
    ...(window.extraActions || []),
    ...Object.entries(THEMES).map(([k, v]) => ({ t: 'Theme: ' + v.name, i: 'palette', run: () => setSetting('theme', k) })),
  ];

  const build = (q) => {
    const out = [], ql = q.toLowerCase();
    const terms = ql.split(/\s+/).filter(Boolean);
    const sessions = S.tabs.map((t) => {
      const hay = `${t.title} ${t.cwd} ${folderPath(t.folderId).join(' ')} ${(R.get(t.id) || {}).liveTitle || ''}`.toLowerCase();
      if (!terms.every((x) => hay.includes(x))) return null;
      return { t, score: (t.title.toLowerCase().includes(ql) ? 0 : 5) - (isAlive(t.id) ? 2 : 0) - (t.id === S.activeId ? 1 : 0) - t.lastActive / 1e13 };
    }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, q ? 10 : 8);
    if (sessions.length) out.push({ sec: q ? 'Sessions' : 'Sessions — most relevant' });
    sessions.forEach(({ t }) => out.push({ type: 'tab', tab: t, run: () => activate(t.id) }));
    if (q.length >= 2) {
      const hits = [];
      for (const t of S.tabs) {
        const rt = R.get(t.id);
        const text = rt ? termText(rt, 4000) : SNAPS[t.id];
        if (!text) continue;
        let n = 0;
        for (const line of text.split('\n')) {
          if (line.toLowerCase().includes(ql)) { hits.push({ tab: t, line: line.trim() }); if (++n >= 3) break; }
        }
        if (hits.length > 40) break;
      }
      if (hits.length) out.push({ sec: 'Terminal output' });
      hits.slice(0, 25).forEach((hit) => out.push({ type: 'hit', ...hit, run: () => { activate(hit.tab.id); const rt = R.get(hit.tab.id); if (rt) setTimeout(() => rt.search.findNext(q, { decorations: { matchBackground: '#d9775744', activeMatchBackground: '#d97757', matchOverviewRuler: '#d97757', activeMatchColorOverviewRuler: '#d97757' } }), 80); } }));
    }
    const acts = actions.filter((a) => terms.every((x) => a.t.toLowerCase().includes(x))).slice(0, q ? 8 : 6);
    if (acts.length) out.push({ sec: 'Actions' });
    acts.forEach((a) => out.push({ type: 'act', a, run: a.run }));
    return out;
  };

  const draw = () => {
    const q = inp.value.trim();
    results = build(q);
    const picks = results.filter((r) => !r.sec);
    sel = Math.min(sel, Math.max(0, picks.length - 1));
    if (!picks.length) return list.replaceChildren(h('div', { class: 'pal-empty' }, 'Nothing found'));
    let pi = 0;
    list.replaceChildren(...results.map((r) => {
      if (r.sec) return h('div', { class: 'pal-sec' }, r.sec);
      const idx = pi++;
      const base = { class: 'pal-item' + (idx === sel ? ' sel' : ''), 'data-i': idx, onclick: () => choose(r), onmousemove: () => { if (sel !== idx) { sel = idx; markSel(); } } };
      if (r.type === 'tab') {
        const t = r.tab, st = statusOf(t);
        return h('div', base, dotEl(st), h('div', { class: 't' }, h('div', { class: 't1' }, hl(t.title, q)), h('div', { class: 't2 plain' }, [...folderPath(t.folderId), shortPath(t.cwd, HOME)].join('  ›  '))), h('span', { class: 'meta' }, relTime(t.lastActive)));
      }
      if (r.type === 'hit') return h('div', base, h('span', { style: 'color:var(--faint)', html: icon('terminal') }), h('div', { class: 't' }, h('div', { class: 't2' }, hl(r.line.slice(0, 160), q)), h('div', { class: 't1', style: 'font-size:11.5px;color:var(--dim)' }, r.tab.title)));
      return h('div', base, h('span', { style: 'color:var(--dim)', html: icon(r.a.i) }), h('div', { class: 't' }, h('div', { class: 't1' }, r.a.t)), r.a.k && h('kbd', null, r.a.k));
    }));
  };
  const markSel = () => { list.querySelectorAll('.pal-item').forEach((n) => n.classList.toggle('sel', +n.dataset.i === sel)); const el = list.querySelector('.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); };
  const choose = (r) => { m.close(); setTimeout(r.run, 0); };
  let tm;
  inp.addEventListener('input', () => { sel = 0; clearTimeout(tm); tm = setTimeout(draw, 70); });
  inp.addEventListener('keydown', (e) => {
    const picks = results.filter((r) => !r.sec);
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, picks.length); markSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + picks.length) % Math.max(1, picks.length); markSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (picks[sel]) choose(picks[sel]); }
  });
  draw();
  setTimeout(() => inp.focus(), 20);
}

/* ---- settings ---- */
function setSetting(k, v) {
  S.settings[k] = v;
  if (k === 'theme' || k === 'accent') { applyChrome(); }
  if (k === 'bgTheme') { BGFX.set(v); applyChrome(); }
  if (k === 'bgAuto' && window.applyLook) window.applyLook(getTab(S.activeId));
  if (k === 'bgDim') { BGFX.setDim(v); applyChrome(); }
  if (k === 'bgPause') { BGFX.pauseWhenBlurred = v; BGFX.refresh(); }
  if (['fontFamily', 'fontSize', 'lineHeight', 'scrollback', 'cursorStyle', 'cursorBlink'].includes(k)) applySettingsToTerms();
  if (k === 'launchAtLogin') window.api.setLogin(v);
  save(); scheduleRender();
}

function applyChrome() {
  TH = applyTheme(S.settings.theme, (window.deckLook && window.deckLook.accent) || S.settings.accent);
  window.api.overlay(TH.bg, TH.symbol);
  const fx = BGFX.current() && BGFX.current() !== 'none';
  if (fx) { const m = /^#(..)(..)(..)$/.exec(TH.term.background); if (m) TH.term = { ...TH.term, background: `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${Math.max(0, S.settings.bgDim * 0.4)})` }; }
  for (const rt of R.values()) rt.term.options.theme = TH.term;
}

function wallpaperPicker() {
  const s = S.settings;
  const grid = h('div', { class: 'wp-grid' });
  const pick = (key) => { setSetting('bgTheme', key); grid.querySelectorAll('.wp-card').forEach((n) => n.classList.toggle('on', n.dataset.key === key)); };
  const draw = () => {
    grid.textContent = '';
    for (const it of BGFX.list) {
      const card = h('div', { class: 'wp-card' + ((S.settings.bgTheme || 'none') === it.key ? ' on' : ''), title: it.prompt || it.name, 'data-key': it.key, onclick: () => pick(it.key) });
      if (it.kind === 'none') card.append(h('div', { class: 'none' }, 'Off'));
      else if (it.kind === 'ai') card.append(it.poster ? h('img', { src: it.poster }) : h('video', { src: it.file, muted: '', preload: 'metadata' }));
      else { const cv = document.createElement('canvas'); BGFX.preview(it.key, cv); card.append(cv); }
      card.append(h('span', null, it.name));
      if (it.custom) card.append(h('button', { class: 'wp-x', title: 'Delete', html: icon('x', 12), onclick: async (e) => {
        e.stopPropagation(); await window.api.wpDelete(it.id);
        if (S.settings.bgTheme === it.key) setSetting('bgTheme', 'none');
        BGFX.unregister(it.key); draw();
      } }));
      grid.append(card);
    }
    grid.append(h('div', { class: 'wp-card wp-add', title: 'Generate a new animated wallpaper from a prompt', onclick: () => generateWallpaperModal((item) => { BGFX.register([item]); draw(); pick(item.key); }) },
      h('div', { class: 'none', style: 'flex-direction:column;gap:2px' }, h('b', { style: 'font-size:26px;font-weight:300;line-height:1' }, '+'), h('small', null, 'Generate'))));
  };
  draw();
  return grid;
}

function generateWallpaperModal(onDone) {
  const inp = h('textarea', { class: 'inp', rows: 3, style: 'height:auto;padding:9px 11px;resize:none', placeholder: 'e.g. a koi pond at dusk with lily pads and drifting petals', maxlength: 280, spellcheck: 'false' });
  const status = h('div', { style: 'color:var(--dim);min-height:18px;margin-top:10px' });
  let busy = false, off = null;
  const body = h('div', null,
    h('div', { style: 'color:var(--dim);margin-bottom:8px;line-height:1.5' }, 'Describe the scene. Claude generates a short pixel-art clip (Kling 3.0 Turbo via your Higgsfield connector, about 7.5 credits) and loops it. Takes 1-3 minutes, and you can keep working.'),
    inp, status);
  openModal({ title: 'New animated wallpaper', body, foot: [
    { label: 'Cancel', run: (c) => { if (busy) window.api.wpCancel(); c(); } },
    { label: 'Generate', primary: true, run: async (c) => {
      if (busy) return; const prompt = inp.value.trim(); if (!prompt) { status.textContent = 'Describe the wallpaper first.'; return; }
      busy = true; inp.disabled = true; status.textContent = 'Starting…';
      off = window.api.onWp((p) => { status.textContent = p.msg; });
      c(); toast('Generating wallpaper… (1-3 min)');
      const r = await window.api.wpGenerate(prompt); if (off) off();
      if (r.ok) { toast('Wallpaper ready: ' + r.item.name); onDone(r.item); } else toast('Wallpaper failed: ' + String(r.error).slice(0, 160), null, null, 9000);
    } }] });
  setTimeout(() => inp.focus(), 50);
}

function settingsModal() {
  const s = S.settings;
  const toggle = (k) => { const el = h('div', { class: 'switch' + (s[k] ? ' on' : ''), onclick: () => { setSetting(k, !s[k]); el.classList.toggle('on', s[k]); } }); return el; };
  const text = (k, cls) => h('input', { class: 'inp ' + (cls || ''), value: s[k], spellcheck: 'false', onchange: (e) => setSetting(k, e.target.value.trim()) });
  const num = (k, min, max, step) => h('input', { class: 'inp num', type: 'number', min, max, step: step || 1, value: s[k], onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setSetting(k, Math.max(min, Math.min(max, v))); } });
  const sel = (k, opts) => h('select', { class: 'inp', onchange: (e) => setSetting(k, e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: s[k] === v }, l)));
  const row = (lbl, sub, ctl) => h('div', { class: 'setrow' }, h('div', { class: 'lbl' }, lbl, sub && h('small', null, sub)), ctl);
  const swatches = h('div', { style: 'display:flex;gap:8px' }, Object.entries(ACCENTS).map(([k, c]) => h('span', { class: 'swatch' + (s.accent === k ? ' on' : ''), style: `background:${c}`, title: k, onclick: (e) => { setSetting('accent', k); e.target.parentNode.querySelectorAll('.swatch').forEach((n) => n.classList.remove('on')); e.target.classList.add('on'); } })));
  const login = toggle('launchAtLogin');
  window.api.getLogin().then((v) => login.classList.toggle('on', v));
  const body = h('div', null,
    h('div', { class: 'group-title' }, 'Startup & restore'),
    row('When Claude Deck opens', 'What happens to the sessions that were open before a reboot or quit', sel('autoRestore', [['ask', 'Ask me which to resume'], ['all', 'Resume all automatically'], ['none', 'Do nothing']])),
    row('Launch when I sign in to Windows', 'So your workspace is one click away after a restart', login),
    row('Keep running in the tray when closed', 'Closing the window hides it instead of putting sessions to sleep (Quit from the tray icon)', h('div', { class: 'switch' + (s.closeToTray ? ' on' : ''), onclick: (e) => { setSetting('closeToTray', !s.closeToTray); e.currentTarget.classList.toggle('on', s.closeToTray); window.api.setTray(s.closeToTray); } })),
    row('Updates', 'Checks GitHub releases once a day', h('button', { class: 'btn', onclick: () => window.extras.checkUpdate(true) }, 'Check now')),
    h('div', { class: 'group-title' }, 'Appearance'),
    row('Theme', null, sel('theme', Object.entries(THEMES).map(([k, v]) => [k, v.name]))),
    row('Accent color', null, swatches),
    h('div', { class: 'group-title' }, 'Animated wallpaper'),
    wallpaperPicker(),
    row('Auto wallpaper by time of day', 'Clouds by day, sunset in the evening, moonlit at night (overrides the choice above)', toggle('bgAuto')),
    row('Wallpaper brightens while Claude works', 'A gentle pulse so you can see activity at a glance', toggle('bgReact')),
    row('Readability scrim', 'How strongly panels cover the wallpaper', h('input', { type: 'range', min: 0.2, max: 0.95, step: 0.05, value: s.bgDim, oninput: (e) => setSetting('bgDim', parseFloat(e.target.value)) })),
    row('Pause when the window is in the background', 'Saves CPU/GPU', toggle('bgPause')),
    row('Font family', 'Any installed monospace font', text('fontFamily')),
    row('Font size', 'Also Ctrl + / Ctrl − / Ctrl+scroll', num('fontSize', 9, 30)),
    row('Line height', null, num('lineHeight', 1, 1.6, 0.05)),
    row('GPU rendering (WebGL)', 'Faster, smoother output for the visible tab', toggle('webgl')),
    h('div', { class: 'group-title' }, 'Terminal'),
    row('Default Claude flags', 'Pre-filled for each new session, e.g. --model opus', text('claudeArgs')),
    row('Default working directory', 'Blank = your home folder', text('defaultCwd')),
    row('Shell', 'auto = PowerShell 7 if installed, else Windows PowerShell', text('shell')),
    row('Scrollback lines', 'Applies to new terminals', num('scrollback', 1000, 100000, 1000)),
    row('Cursor', null, sel('cursorStyle', [['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']])),
    row('Copy on select', null, toggle('copyOnSelect')),
    row('Soft chime when a session finishes all its work', 'A quiet two-note ping, only for tabs you aren\'t looking at', toggle('pingSound')),
    row('Desktop notification when a session finishes', 'Silent toast + taskbar flash while Claude Deck is in the background', toggle('notify')));
  if (typeof window.tgSettingsSection === 'function') body.append(window.tgSettingsSection());
  openModal({ title: 'Settings', body, wide: true, foot: [{ label: 'Done', primary: true, run: (c) => c() }] });
}

/* =========================================================================
   Find bar, sidebar, shortcuts
   ========================================================================= */
let findCase = false;
function openFind() {
  const rt = R.get(S.activeId);
  if (!rt) return;
  const bar = $('#findbar'); bar.classList.remove('hidden');
  const inp = $('#findInput');
  const sel = rt.term.getSelection();
  if (sel && !sel.includes('\n')) inp.value = sel;
  inp.focus(); inp.select();
}
function closeFind() { $('#findbar').classList.add('hidden'); const rt = R.get(S.activeId); if (rt) { rt.search.clearDecorations(); rt.term.focus(); } }
function doFind(dir, incremental) {
  const rt = R.get(S.activeId), q = $('#findInput').value;
  if (!rt || !q) return;
  const opts = { caseSensitive: findCase, incremental: !!incremental, decorations: { matchBackground: '#d9775744', activeMatchBackground: '#d97757', matchOverviewRuler: '#d97757', activeMatchColorOverviewRuler: '#d97757' } };
  dir < 0 ? rt.search.findPrevious(q, opts) : rt.search.findNext(q, opts);
}

function toggleSidebar() {
  S.ui.sidebar = !S.ui.sidebar;
  $('#app').classList.toggle('no-sb', !S.ui.sidebar);
  save(); setTimeout(fitAll, 30);
}

window.addEventListener('keydown', (e) => {
  if (!S) return;
  const k = e.key.toLowerCase();
  if (modalDepth && !(e.ctrlKey && k === 'k')) return;
  if (!e.ctrlKey || e.altKey) { if (k === 'f2' && S.activeId) renameTab(S.activeId); return; }
  const go = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
  if (k === 't' && e.shiftKey) return go(reopenClosed);
  if (k === 't') return go(() => newSessionModal({ folderId: (getTab(S.activeId) || {}).folderId }));
  if (k === 'w') return go(() => S.activeId && requestSleep(S.activeId));
  if (k === 'k') return go(() => { if (modalDepth) return; paletteModal(); });
  if (k === 'b') return go(toggleSidebar);
  if (k === 'f') return go(openFind);
  if (k === 'h') return go(historyModal);
  if (k === ',') return go(settingsModal);
  if (k === 'n' && e.shiftKey) return go(async () => { const n = await promptModal('New folder', '', 'Folder name'); if (n) newFolder(null, n); });
  if (k === 'tab') return go(() => cycle(e.shiftKey ? -1 : 1));
  if (k === '=' || k === '+') return go(() => zoom(1));
  if (k === '-') return go(() => zoom(-1));
  if (k === '0') return go(() => zoom(0));
  if (/^[1-9]$/.test(k)) return go(() => { const t = liveTabs()[+k - 1]; if (t) activate(t.id); });
}, true);

/* =========================================================================
   Boot
   ========================================================================= */
function defaultState() {
  return { v: 1, folders: [], tabs: [], activeId: null, closed: [], ui: { sbw: 296, sidebar: true, lastCwd: '' }, settings: { ...DEFAULT_SETTINGS } };
}

async function boot() {
  const loaded = await window.api.loadState();
  HOME = loaded.home; SNAPS = loaded.snaps || {};
  const base = defaultState();
  S = loaded.state ? { ...base, ...loaded.state, settings: { ...base.settings, ...(loaded.state.settings || {}) }, ui: { ...base.ui, ...(loaded.state.ui || {}) } } : base;
  S.tabs.forEach((t) => { t.sessionId = t.sessionId || uid(); });
  try { BGFX.register(await window.api.wpList()); } catch { /* none */ }
  BGFX.pauseWhenBlurred = S.settings.bgPause !== false; BGFX.setDim(S.settings.bgDim); BGFX.set(S.settings.bgTheme, { instant: true });
  applyChrome();
  hydrateIcons();
  document.documentElement.style.setProperty('--sbw', S.ui.sbw + 'px');
  $('#app').classList.toggle('no-sb', !S.ui.sidebar);
  fitSeed();

  // wiring
  $('#btnNew').onclick = $('#btnNew2').onclick = $('#emptyNew').onclick = () => newSessionModal({ folderId: (getTab(S.activeId) || {}).folderId });
  $('#emptyHist').onclick = $('#btnHistory').onclick = historyModal;
  $('#btnNewFolder').onclick = async () => { const n = await promptModal('New folder', '', 'Folder name'); if (n) newFolder(null, n); };
  $('#btnSettings').onclick = settingsModal;
  $('#btnSidebar').onclick = toggleSidebar;
  $('#searchPill').onclick = paletteModal;
  $('#btnResumeAll').onclick = () => restoreModal(S.tabs.filter((t) => !isAlive(t.id)), false);
  $('#filter').addEventListener('input', () => { $('#filterClear').classList.toggle('hidden', !$('#filter').value); renderTree(); });
  $('#filterClear').onclick = () => { $('#filter').value = ''; $('#filterClear').classList.add('hidden'); renderTree(); };
  $('#findInput').addEventListener('input', () => doFind(1, true));
  $('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doFind(e.shiftKey ? -1 : 1); if (e.key === 'Escape') closeFind(); });
  $('#findNext').onclick = () => doFind(1); $('#findPrev').onclick = () => doFind(-1); $('#findClose').onclick = closeFind;
  $('#findCase').onclick = (e) => { findCase = !findCase; e.currentTarget.classList.toggle('on', findCase); doFind(1, true); };
  $('#stripTabs').addEventListener('wheel', (e) => { $('#stripTabs').scrollLeft += e.deltaY; });

  // tree-level drop = move to top level
  const tree = $('#tree');
  tree.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); } });
  tree.addEventListener('drop', (e) => {
    if (!dragging) return; e.preventDefault();
    const d = dragging; dragEnd();
    if (d.type === 'tab') moveTab(d.id, null, null, false, false); else moveFolder(d.id, null, null);
  });

  // sidebar resize
  const rz = $('#resizer');
  rz.addEventListener('pointerdown', (e) => {
    rz.setPointerCapture(e.pointerId); rz.classList.add('drag');
    const mv = (ev) => { const w = Math.max(210, Math.min(560, ev.clientX)); document.documentElement.style.setProperty('--sbw', w + 'px'); S.ui.sbw = w; };
    const up = () => { rz.classList.remove('drag'); rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); save(); fitAll(); };
    rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
  });

  let rq = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rq); rq = requestAnimationFrame(fitAll); }).observe($('#termHost'));

  window.api.onFlush(() => { persistSnaps(); save(true).then(() => window.api.flushed()); });
  setInterval(persistSnaps, 20000);

  // drop stale ids
  if (S.activeId && !getTab(S.activeId)) S.activeId = null;
  S.tabs.forEach((t) => { if (t.folderId && !getFolder(t.folderId)) t.folderId = null; });
  renderAll();

  // restore flow
  const wasOpen = S.tabs.filter((t) => t.open);
  const mode = new URLSearchParams(location.search).get('restore') || S.settings.autoRestore;
  if (wasOpen.length && !SMOKE_MODE) {
    if (mode === 'all') {
      const first = getTab(S.activeId) && wasOpen.includes(getTab(S.activeId)) ? S.activeId : wasOpen[0].id;
      resumeMany([first, ...wasOpen.map((t) => t.id).filter((i) => i !== first)]);
    } else if (mode === 'ask') {
      setTimeout(() => restoreModal(S.tabs.slice().sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || b.lastActive - a.lastActive).filter((t) => t.open), true), 250);
    } else S.tabs.forEach((t) => { t.open = false; });
  }
  if (S.activeId) activate(S.activeId, { resume: false });
}
const SMOKE_MODE = new URLSearchParams(location.search).has('smoke');
function fitSeed() { /* placeholder for future per-window sizing */ }

window.__deck = { get S() { return S; }, setSetting, getFolder, createTab, R, activate, paletteModal, settingsModal, historyModal, newSessionModal, newFolder, restoreModal, getTab, sleepTab };
boot();
