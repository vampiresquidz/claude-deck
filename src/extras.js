'use strict';
/* Claude Deck extras: context meter, attention inbox, broadcast, folder looks, split view,
   transcript export, update check, time-of-day / reactive wallpapers.
   Loaded after renderer.js; the renderer calls the window.* hooks below when they exist. */
/* global S, R, h, $, toast, showMenu, openModal, getTab, getFolder, isAlive, termText, activate, ACCENTS, icon, folderPath, scheduleRender, save, applyChrome, BGFX, showPane, fitAll, setSetting, liveTabs, statusOf, shortPath, HOME */
(function () {
  const api = window.api;
  const CTX = {};
  const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const sev = (pct) => (pct >= 90 ? 'var(--err)' : pct >= 70 ? 'var(--warn)' : 'var(--dim)');

  /* ---------- context meter ---------- */
  async function pollCtx() {
    if (!S) return;
    const tabs = S.tabs.filter((t) => t.kind === 'claude' && isAlive(t.id));
    if (!tabs.length) return;
    let r; try { r = await api.ctxUsage(tabs.map((t) => t.sessionId)); } catch { return; }
    let changed = false;
    for (const t of tabs) {
      const u = r[t.sessionId]; if (!u) continue;
      const pct = Math.min(100, Math.round((u.tokens / u.limit) * 100));
      if (!CTX[t.id] || CTX[t.id].tokens !== u.tokens) changed = true;
      CTX[t.id] = { ...u, pct };
    }
    if (changed) scheduleRender();
  }
  setInterval(pollCtx, 20000); setTimeout(pollCtx, 5000);
  window.ctxChip = (tab) => {
    const c = CTX[tab.id]; if (!c || tab.kind !== 'claude') return null;
    return h('span', { class: 'chip', title: `Context window: ${c.tokens.toLocaleString()} of ${c.limit.toLocaleString()} tokens (${c.model || 'model unknown'}). /compact before it fills.`, style: `color:${sev(c.pct)}` }, h('span', { html: icon('sparkle', 13) }), `${fmtK(c.tokens)} · ${c.pct}%`);
  };
  window.ctxBar = (tab) => {
    const c = CTX[tab.id]; if (!c) return null;
    return h('div', { class: 'ctxbar', title: `Context ${c.pct}% full (${fmtK(c.tokens)} tokens)` }, h('i', { style: `width:${c.pct}%;background:${c.pct >= 90 ? 'var(--err)' : c.pct >= 70 ? 'var(--warn)' : 'var(--accent)'}` }));
  };

  /* ---------- attention inbox: sessions waiting on a permission prompt or question ---------- */
  const PROMPT_RE = /(Do you want to|Would you like to|\(y\/n\)|Enter to select|Esc to cancel|❯\s*1\.\s)/;
  setInterval(() => {
    if (!S) return;
    let changed = false;
    for (const t of S.tabs) {
      const rt = R.get(t.id);
      if (!rt || !rt.alive || t.kind !== 'claude') { if (rt && rt.needs) { rt.needs = false; changed = true; } continue; }
      const idle = Date.now() - (rt.lastData || 0) > 2500;
      const needs = !rt.working && idle && PROMPT_RE.test(termText(rt, 120).split(String.fromCharCode(10)).slice(-14).join(' '));
      if (needs && !rt.needs) {
        rt.needs = true; changed = true;
        if (!(t.id === S.activeId && document.hasFocus())) {
          if (S.settings.notify && !document.hasFocus()) {
            try { const n = new Notification(`${t.title} needs you`, { body: 'Waiting for your answer.', silent: true }); n.onclick = () => { window.focus(); activate(t.id); }; } catch { /* ignore */ }
            api.flash();
          }
          if (typeof window.tgOnNeeds === 'function') window.tgOnNeeds(t.id);
        }
      } else if (!needs && rt.needs) { rt.needs = false; changed = true; }
    }
    if (changed) scheduleRender();
  }, 2000);

  function renderInbox() {
    const foot = document.querySelector('.sb-foot'); if (!foot) return;
    let b = $('#inbox');
    const waiting = S.tabs.filter((t) => (R.get(t.id) || {}).needs);
    if (!b) { b = h('button', { id: 'inbox', class: 'foot-btn hidden' }); foot.prepend(b); }
    b.classList.toggle('hidden', !waiting.length);
    if (!waiting.length) return;
    b.title = 'Sessions waiting for your answer';
    b.replaceChildren(h('span', { class: 'dot attn' }), `${waiting.length} need${waiting.length === 1 ? 's' : ''} you`);
    b.onclick = (e) => { const r = b.getBoundingClientRect(); showMenu(waiting.map((t) => ({ label: t.title, icon: 'terminal', run: () => activate(t.id) })), r.left, r.top - 8 - waiting.length * 34); void e; };
  }

  /* ---------- broadcast ---------- */
  function broadcastModal() {
    const tabs = liveTabs();
    if (!tabs.length) return toast('No live sessions to message');
    const picks = new Set(tabs.map((t) => t.id));
    const ta = h('textarea', { class: 'inp', rows: 4, style: 'height:auto;padding:9px 11px;resize:vertical', placeholder: 'Message to send to every selected session…', spellcheck: 'false' });
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto;margin-bottom:10px' }, tabs.map((t) => {
      const cb = h('input', { type: 'checkbox', checked: '', onchange: () => (cb.checked ? picks.add(t.id) : picks.delete(t.id)) });
      return h('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 6px;border-radius:7px;cursor:pointer' }, cb, h('span', null, t.title), h('span', { style: 'color:var(--faint);font-size:11.5px' }, folderPath(t.folderId).join(' › ')));
    }));
    const body = h('div', null, h('div', { style: 'color:var(--dim);margin-bottom:8px' }, 'Send the same message to several sessions (it is typed in and submitted).'), list, ta);
    openModal({ title: 'Broadcast message', body, foot: [{ label: 'Cancel', run: (c) => c() }, { label: 'Send', primary: true, run: async (c) => {
      const text = ta.value.trim(); if (!text || !picks.size) return; c();
      for (const id of picks) { const rt = R.get(id); if (rt && rt.alive) { rt.term.paste(text); await new Promise((r) => setTimeout(r, 250)); api.write(id, '\r'); } }
      toast(`Sent to ${picks.size} session${picks.size === 1 ? '' : 's'}`);
    } }] });
    setTimeout(() => ta.focus(), 40);
  }

  /* ---------- folder looks (wallpaper + accent per folder, inherited by subfolders) ---------- */
  const deckLook = { accent: null, bg: null };
  window.deckLook = deckLook;
  function lookFor(tab) {
    let f = tab && getFolder(tab.folderId), guard = 0;
    while (f && guard++ < 20) { if (f.look && (f.look.bg || f.look.accent)) return f.look; f = getFolder(f.parentId); }
    return null;
  }
  const baseBg = () => {
    if (!S.settings.bgAuto) return S.settings.bgTheme;
    const hr = new Date().getHours();
    return hr >= 5 && hr < 17 ? 'clouds' : hr >= 17 && hr < 20 ? 'ai-sunset' : 'moonlit';
  };
  window.applyLook = (tab) => {
    const look = lookFor(tab);
    const nb = look && look.bg ? look.bg : baseBg(), na = look && look.accent ? look.accent : null;
    const bgChanged = BGFX.current() !== nb && (BGFX.list.some((x) => x.key === nb) || nb === 'none');
    if (bgChanged) BGFX.set(nb);
    if (deckLook.accent !== na || bgChanged) { deckLook.accent = na; deckLook.bg = nb; applyChrome(); }
  };
  setInterval(() => { if (S && S.settings.bgAuto) window.applyLook(getTab(S.activeId)); }, 10 * 60 * 1000);

  function lookModal(f) {
    const look = { ...(f.look || {}) };
    const wp = h('select', { class: 'inp' }, [h('option', { value: '' }, 'Inherit (global wallpaper)'), ...BGFX.list.map((x) => h('option', { value: x.key, selected: look.bg === x.key }, x.name))]);
    wp.onchange = () => { look.bg = wp.value || null; };
    const sw = h('div', { style: 'display:flex;gap:8px;align-items:center' }, [null, ...Object.keys(ACCENTS)].map((k) => h('span', { class: 'swatch' + ((look.accent || null) === k ? ' on' : ''), style: `background:${k ? ACCENTS[k] : 'var(--bg3)'}`, title: k || 'Inherit', onclick: (e) => { look.accent = k; e.target.parentNode.querySelectorAll('.swatch').forEach((n) => n.classList.remove('on')); e.target.classList.add('on'); } })));
    const body = h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Wallpaper'), wp),
      h('div', { class: 'field' }, h('label', null, 'Accent color'), sw),
      h('div', { class: 'hint' }, 'Applies while a session in this folder (or its subfolders) is active.'));
    openModal({ title: `Look for “${f.name}”`, body, foot: [{ label: 'Cancel', run: (c) => c() }, { label: 'Save', primary: true, run: (c) => { f.look = look.bg || look.accent ? { bg: look.bg || null, accent: look.accent || null } : null; c(); save(); window.applyLook(getTab(S.activeId)); scheduleRender(); } }] });
  }

  /* ---------- split view ---------- */
  function splitWith(id) {
    if (id === S.activeId) return toast('Pick a different session to put beside this one');
    if (!isAlive(id)) { const t = getTab(id); activate(id); S.ui.split = null; toast(`Resumed “${t.title}” — right-click it again to open it beside`); return; }
    S.ui.split = id; save(); showPane(S.activeId, true); requestAnimationFrame(fitAll); scheduleRender();
  }
  function closeSplit() { S.ui.split = null; save(); showPane(S.activeId); requestAnimationFrame(fitAll); scheduleRender(); }

  /* ---------- export / update / wallpapers ---------- */
  async function exportTab(tab) {
    const r = await api.exportSession(tab.sessionId, tab.title);
    if (r.ok) toast('Transcript saved', 'Show', () => api.openPath(r.path.replace(/[\\/][^\\/]*$/, '')));
    else if (!r.canceled) toast(r.error || 'Export failed');
  }
  async function checkUpdate(manual) {
    const r = await api.checkUpdate();
    if (!r.ok) { if (manual) toast('Update check failed: ' + r.error); return; }
    if (r.newer) toast(`Claude Deck ${r.latest} is available (you have ${r.current})`, 'Download', () => api.openExternal(r.url), 15000);
    else if (manual) toast(`You're up to date (${r.current})`);
  }
  window.extras = { broadcastModal, lookModal, splitWith, closeSplit, exportTab, checkUpdate };
  window.extraActions = [
    { t: 'Broadcast message to sessions…', i: 'sparkle', k: 'Ctrl Shift B', run: broadcastModal },
    { t: 'Close split view', i: 'sidebar', run: closeSplit },
    { t: 'Check for updates', i: 'history', run: () => checkUpdate(true) },
  ];
  window.addEventListener('keydown', (e) => { if (S && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); broadcastModal(); } }, true);
  window.extrasRender = renderInbox;

  // wallpaper brightens while any session is working
  let curDim = null;
  setInterval(() => {
    if (!S || !S.settings.bgReact || BGFX.current() === 'none') { if (curDim !== null) { BGFX.setDim(S ? S.settings.bgDim : 0.5); curDim = null; } return; }
    const working = [...R.values()].some((rt) => rt.alive && rt.working);
    const base = S.settings.bgDim, target = working ? Math.max(0.12, base - 0.3) : base;
    curDim = curDim == null ? base : curDim + (target - curDim) * 0.25;
    BGFX.setDim(curDim);
  }, 250);

  // once the state is loaded: tray + daily update check
  const wait = setInterval(() => {
    if (!S) return; clearInterval(wait);
    api.setTray(!!S.settings.closeToTray);
    if (Date.now() - (S.settings.lastUpdateCheck || 0) > 24 * 3600 * 1000) { S.settings.lastUpdateCheck = Date.now(); save(); setTimeout(() => checkUpdate(false), 8000); }
  }, 300);
})();
