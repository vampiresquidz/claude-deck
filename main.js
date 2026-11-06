'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, nativeImage, safeStorage } = require('electron');
const { Telegram } = require('./telegram');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');

app.setName('ClaudeDeck');

const SMOKE = process.env.CT_SMOKE === '1';
if (SMOKE) app.setPath('userData', path.join(os.tmpdir(), 'claudedeck-smoke'));

const DATA = app.getPath('userData');
const F_STATE = path.join(DATA, 'state.json');
const F_SNAPS = path.join(DATA, 'snapshots.json');
const F_WIN = path.join(DATA, 'window.json');
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

fs.mkdirSync(DATA, { recursive: true });

/* ---------- atomic JSON helpers (survive power loss mid-write) ---------- */
function readJSON(file, fallback) {
  for (const f of [file, file + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try next */ }
  }
  return fallback;
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ }
  fs.renameSync(tmp, file);
}

/* ---------- single instance ---------- */
if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

let win = null;
let quitting = false;
let flushed = false;
const ptys = new Map(); // id -> { p, buf, timer }

/* ---------- shell detection ---------- */
let shellExe = null;
function detectShell(pref) {
  if (pref && pref !== 'auto') return pref;
  if (shellExe) return shellExe;
  try {
    const out = execFileSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).find(Boolean);
    if (first) return (shellExe = first.trim());
  } catch { /* no pwsh */ }
  return (shellExe = 'powershell.exe');
}

/* ---------- Claude session helpers ---------- */
function findSessionFile(id) {
  try {
    for (const d of fs.readdirSync(CLAUDE_PROJECTS)) {
      const f = path.join(CLAUDE_PROJECTS, d, id + '.jsonl');
      if (fs.existsSync(f)) return f;
    }
  } catch { /* no projects dir yet */ }
  return null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content) if (c && c.type === 'text' && typeof c.text === 'string') return c.text;
  }
  return '';
}

async function listClaudeSessions() {
  const files = [];
  let dirs = [];
  try { dirs = await fs.promises.readdir(CLAUDE_PROJECTS); } catch { return []; }
  for (const d of dirs) {
    const dir = path.join(CLAUDE_PROJECTS, d);
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      try {
        const st = await fs.promises.stat(f);
        if (st.size > 200) files.push({ f, id: n.slice(0, -6), mtime: st.mtimeMs, size: st.size });
      } catch { /* skip */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const top = files.slice(0, 400);
  const out = [];
  for (const it of top) {
    let cwd = '', title = '', summary = '';
    try {
      const fh = await fs.promises.open(it.f, 'r');
      const buf = Buffer.alloc(Math.min(96 * 1024, it.size));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
        if (j.type === 'summary' && j.summary && !summary) summary = j.summary;
        if (!title && j.type === 'user' && j.message && !j.isMeta) {
          const t = textOf(j.message.content).trim();
          if (t && !t.startsWith('<') && !t.startsWith('Caveat:')) title = t.replace(/\s+/g, ' ').slice(0, 160);
        }
        if (cwd && title) break;
      }
    } catch { /* unreadable */ }
    if (!cwd) continue; // not a real conversation
    out.push({ id: it.id, cwd, title: summary || title || '(no prompt)', mtime: it.mtime });
  }
  return out;
}

/* ---------- PTY ---------- */
function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ClaudeDeck' };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE')) delete env[k];
  return env;
}

function spawnPty(o) {
  if (ptys.has(o.id)) return { ok: true, mode: 'attached' };
  let cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  const exe = detectShell(o.shell);
  const args = ['-NoLogo'];
  let mode = 'shell';
  if (o.kind === 'claude') {
    const extra = (o.args || '').trim();
    const resume = !!findSessionFile(o.sessionId);
    mode = resume ? 'resume' : 'new';
    const flag = resume ? `--resume ${o.sessionId}` : `--session-id ${o.sessionId}`;
    args.push('-NoExit', '-Command', `claude ${flag}${extra ? ' ' + extra : ''}`);
  }
  let p;
  try {
    p = pty.spawn(exe, args, {
      name: 'xterm-256color', cols: o.cols || 120, rows: o.rows || 30, cwd, env: cleanEnv(), useConpty: true,
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
  const ent = { p, buf: '', timer: null };
  ptys.set(o.id, ent);
  const flush = () => {
    ent.timer = null;
    if (!ent.buf) return;
    const d = ent.buf; ent.buf = '';
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', o.id, d);
  };
  p.onData((d) => {
    ent.buf += d;
    if (ent.buf.length > 65536) { if (ent.timer) clearTimeout(ent.timer); flush(); }
    else if (!ent.timer) ent.timer = setTimeout(flush, 8);
  });
  p.onExit(({ exitCode }) => {
    if (ent.timer) clearTimeout(ent.timer);
    flush();
    if (ptys.get(o.id) === ent) ptys.delete(o.id);
    if (!quitting && win && !win.isDestroyed()) win.webContents.send('pty:exit', o.id, exitCode);
  });
  return { ok: true, mode, pid: p.pid };
}

function killPty(id) {
  const e = ptys.get(id);
  if (!e) return;
  ptys.delete(id);
  try { e.p.kill(); } catch { /* already gone */ }
}

/* ---------- IPC ---------- */
ipcMain.handle('state:load', () => ({ state: readJSON(F_STATE, null), snaps: readJSON(F_SNAPS, {}), home: os.homedir() }));
ipcMain.handle('state:save', (_e, s) => { try { writeJSON(F_STATE, s); return true; } catch { return false; } });
ipcMain.handle('snaps:save', (_e, s) => { try { writeJSON(F_SNAPS, s); return true; } catch { return false; } });

ipcMain.handle('pty:spawn', (_e, o) => spawnPty(o));
ipcMain.on('pty:write', (_e, id, d) => { const e = ptys.get(id); if (e) e.p.write(d); });
ipcMain.on('pty:resize', (_e, id, c, r) => { const e = ptys.get(id); if (e && c > 0 && r > 0) { try { e.p.resize(c, r); } catch { /* ignore */ } } });
ipcMain.on('pty:kill', (_e, id) => killPty(id));

ipcMain.handle('dialog:pickDir', async (_e, start) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: start || os.homedir() });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('fs:isDir', (_e, p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
ipcMain.handle('sessions:list', () => listClaudeSessions());
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, t) => clipboard.writeText(String(t)));
ipcMain.on('shell:open', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('shell:reveal', (_e, p) => { try { shell.openPath(p); } catch { /* ignore */ } });
ipcMain.handle('app:setLogin', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle('app:getLogin', () => app.getLoginItemSettings().openAtLogin);
ipcMain.on('win:overlay', (_e, color, symbolColor) => {
  if (win && !win.isDestroyed() && process.platform === 'win32') {
    try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch { /* ignore */ }
  }
});
/* ---- Telegram remote control ---- */
let tg = null;
const toRenderer = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
ipcMain.handle('tg:status', () => tg.status());
ipcMain.handle('tg:setToken', async (_e, t) => { try { return { ok: true, status: await tg.setToken(t) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('tg:enable', (_e, on) => { tg.setEnabled(on); return tg.status(); });
ipcMain.handle('tg:pair', () => tg.newPair());
ipcMain.handle('tg:unpair', () => { tg.unpair(); return tg.status(); });
ipcMain.on('tg:send', (_e, html, home) => { tg.send(String(html), null, !!home).catch(() => {}); });

ipcMain.on('app:flushed', () => {
  flushed = true; if (win && !win.isDestroyed()) win.close(); });
ipcMain.on('win:focusFlash', () => { if (win && !win.isFocused()) win.flashFrame(true); });

/* ---------- window ---------- */
function createWindow() {
  const b = readJSON(F_WIN, { width: 1440, height: 900 });
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 820, minHeight: 520,
    backgroundColor: '#0b0d12',
    show: false,
    title: 'Claude Deck',
    icon: fs.existsSync(path.join(__dirname, 'build', 'icon.png')) ? nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')) : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#aab2c5', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  if (b.max) win.maximize();
  // ready-to-show is unreliable here (hidden window never paints), so also show once the page has loaded.
  let shown = false;
  const showOnce = () => { if (!shown && win && !win.isDestroyed()) { shown = true; win.show(); } };
  win.once('ready-to-show', showOnce);
  win.webContents.once('did-finish-load', showOnce);
  setTimeout(showOnce, 4000);
  win.loadFile(path.join(__dirname, 'src', 'index.html'), SMOKE ? { query: { smoke: '1' } } : undefined);

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) win.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) e.preventDefault(); // never reload by accident
  });

  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const max = win.isMaximized();
    const r = max ? (readJSON(F_WIN, {})) : win.getBounds();
    try { writeJSON(F_WIN, { ...r, max }); } catch { /* ignore */ }
  };
  win.on('resize', () => { clearTimeout(win._bt); win._bt = setTimeout(saveBounds, 400); });
  win.on('move', () => { clearTimeout(win._bt); win._bt = setTimeout(saveBounds, 400); });

  win.on('close', (e) => {
    saveBounds();
    if (flushed || SMOKE) { quitting = true; return; }
    e.preventDefault();
    quitting = true; // stop exit events from clearing "open" flags
    win.webContents.send('app:flush');
    setTimeout(() => { flushed = true; if (!win.isDestroyed()) win.close(); }, 2000);
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  tg = new Telegram(DATA, safeStorage, (ev, p) => toRenderer(ev === 'message' ? 'tg:message' : 'tg:status', p));
  createWindow();
  if (!SMOKE) win.webContents.once('did-finish-load', () => setTimeout(() => tg.start(), 1500));
  if (SMOKE) require('./smoke')(() => win, ptys);
});
app.on('before-quit', () => {
  quitting = true; if (tg) tg.stop(); });
app.on('window-all-closed', () => {
  for (const id of [...ptys.keys()]) killPty(id);
  app.quit();
});
