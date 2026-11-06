'use strict';
/* global S, R, getTab, h, icon, $, toast, startPty, sleepTab, createTab, activate, termText, scheduleRender, folderPath, save, HOME */
// Telegram remote control — command layer. The paired chat is the only source of messages (enforced in main).

const TG = (() => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const api = window.api;
  const T = { out: (html, home) => api.tgSend(html, home) }; // home=true → alerts go to the home chat, not the last chat
  let snap = [];          // tab ids as numbered by the last /list
  let target = null;      // sticky target for plain messages
  const waiting = new Map(); // tabId -> { since, msg, saw }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ICON = { sleep: '💤', idle: '🟢', work: '🟠', unread: '🟡', exit: '🔴' };

  function stat(tab) {
    const rt = R.get(tab.id);
    if (!rt) return 'sleep';
    if (rt.exited) return 'exit';
    if (!rt.alive) return 'sleep';
    if (rt.working || rt.titleBusy) return 'work';
    if (rt.unread) return 'unread';
    return 'idle';
  }

  function groups() {
    const g = [];
    const walk = (pid, pathArr) => {
      for (const f of S.folders.filter((x) => x.parentId === pid)) {
        const p = [...pathArr, f.name];
        const own = S.tabs.filter((t) => t.folderId === f.id);
        if (own.length) g.push({ name: p.join(' › '), tabs: own });
        walk(f.id, p);
      }
    };
    walk(null, []);
    const seen = new Set(g.flatMap((x) => x.tabs.map((t) => t.id)));
    const rest = S.tabs.filter((t) => !seen.has(t.id));
    if (rest.length) g.push({ name: 'Unsorted', tabs: rest });
    return g;
  }
  const refreshSnap = () => { snap = groups().flatMap((g) => g.tabs.map((t) => t.id)); };

  function listText() {
    refreshSnap();
    if (!snap.length) return 'No sessions yet. Create one with /new C:\\path\\to\\project';
    let n = 0;
    const live = S.tabs.filter((t) => R.get(t.id) && R.get(t.id).alive).length;
    const out = [`<b>Sessions</b> — ${live} live / ${S.tabs.length}\n🟢 ready  🟠 working  🟡 finished  💤 asleep\n`];
    for (const g of groups()) {
      out.push(`<b>${esc(g.name)}</b>`);
      for (const t of g.tabs) {
        n++;
        const rt = R.get(t.id), lt = rt && rt.liveTitle && rt.liveTitle !== t.title ? ` — <i>${esc(rt.liveTitle.slice(0, 45))}</i>` : '';
        out.push(`<code>${String(n).padStart(2)}</code> ${ICON[stat(t)]} ${esc(t.title.slice(0, 48))}${lt}${t.kind === 'shell' ? ' ⌨️' : ''}`);
      }
      out.push('');
    }
    out.push(target && getTab(target) ? `Default target: <b>${esc(getTab(target).title.slice(0, 40))}</b>` : 'Tip: <code>@3 your message</code> or <code>/use 3</code> then just type.');
    return out.join('\n');
  }

  function parseRef(arg) {
    arg = arg.trim();
    let ref, rest;
    const q = arg.match(/^"([^"]+)"\s*([\s\S]*)$/);
    if (q) { ref = q[1]; rest = q[2]; }
    else { const m = arg.match(/^(\S+)\s*([\s\S]*)$/); ref = m ? m[1] : ''; rest = m ? m[2] : ''; }
    return { ref, rest };
  }

  function resolve(ref) {
    if (!ref) return { error: 'Which session? Use a number from /list or part of its name.' };
    if (/^\d+$/.test(ref)) {
      if (!snap.length) refreshSnap();
      const id = snap[+ref - 1], t = id && getTab(id);
      return t ? { tab: t } : { error: `No session #${ref}. Send /list to refresh numbering.` };
    }
    const q = ref.toLowerCase();
    const hits = S.tabs.filter((t) => `${t.title} ${t.cwd} ${folderPath(t.folderId).join(' ')}`.toLowerCase().includes(q));
    if (hits.length === 1) return { tab: hits[0] };
    if (!hits.length) return { error: `Nothing matches “${esc(ref)}”.` };
    return { error: `“${esc(ref)}” matches ${hits.length} sessions — use a number from /list:\n` + hits.slice(0, 8).map((t) => '• ' + esc(t.title.slice(0, 50))).join('\n') };
  }

  /* ---- screen scraping ---- */
  function screen(rt, anchor, maxLines) {
    let lines = termText(rt, 600).split('\n');
    if (anchor) {
      const key = anchor.trim().split('\n')[0].slice(0, 40);
      if (key) for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes(key)) { lines = lines.slice(i + 1); break; }
    }
    const sep = /^\s*[─━═╌┄╍-]{8,}\s*$/;
    const near = [];
    lines.forEach((l, i) => { if (sep.test(l) && i >= lines.length - 12) near.push(i); });
    if (near.length) lines = lines.slice(0, near[0]); // drop Claude's input box + status chrome
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    lines = lines.map((l) => l.replace(/\s+$/, ''));
    let txt = lines.slice(-(maxLines || 40)).join('\n').replace(/\n{3,}/g, '\n\n');
    if (txt.length > 3400) txt = '…' + txt.slice(-3400);
    return txt || '(nothing yet)';
  }
  const pre = (txt) => `<pre>${esc(txt)}</pre>`;
  const label = (tab) => { const i = snap.indexOf(tab.id); return (i >= 0 ? `${i + 1} · ` : '') + esc(tab.title.slice(0, 40)); };

  /* ---- actions ---- */
  async function waitReady(id, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const rt = R.get(id);
      if (rt && rt.alive && Date.now() > (rt.quietUntil || 0) && !rt.working && !rt.titleBusy) { await sleep(1500); return true; }
      await sleep(500);
    }
    return false;
  }

  async function deliver(tab, text) {
    let rt = R.get(tab.id);
    if (!rt || !rt.alive) {
      T.out(`💤 <b>${label(tab)}</b> is asleep — waking it; your message goes in once it's ready…`);
      await startPty(tab);
      if (!(await waitReady(tab.id, 70000))) return T.out('⚠️ It didn\'t come up in time. Try /peek or /wake.');
      rt = R.get(tab.id);
    }
    rt.term.paste(text);
    await sleep(250);
    api.write(tab.id, '\r');
    rt.unread = false;
    waiting.set(tab.id, { since: Date.now(), msg: text, saw: false });
    T.out(`✉️ sent to <b>${label(tab)}</b> — I'll reply when it finishes.`);
  }

  const KEYS = { enter: '\r', esc: '\x1b', escape: '\x1b', 'ctrl-c': '\x03', c: null, up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', tab: '\t', 'shift-tab': '\x1b[Z', space: ' ', bs: '\x7f', backspace: '\x7f' };

  async function pressKeys(tab, tokens) {
    const rt = R.get(tab.id);
    if (!rt || !rt.alive) return T.out(`💤 ${label(tab)} is asleep. /wake first.`);
    for (const k of tokens) {
      const key = k.toLowerCase();
      const seq = key in KEYS && KEYS[key] != null ? KEYS[key] : (k.length === 1 ? k : null);
      if (seq == null) { T.out(`Unknown key “${esc(k)}”. Try: enter esc up down left right tab shift-tab ctrl-c space, or a single character.`); return; }
      api.write(tab.id, seq); await sleep(120);
    }
    await sleep(900);
    T.out(`<b>${label(tab)}</b>\n` + pre(screen(rt, null, 18)));
  }

  const HELP = [
    '<b>Claude Deck remote — all commands</b>',
    '<code>/list</code> — all sessions, numbered',
    '<code>@3 message</code> or <code>/to 3 message</code> — send to session 3 (number or name, <code>"quoted name"</code> ok)',
    '<code>/use 3</code> — default target; then plain text goes there',
    '<code>/peek 3 [lines]</code> — what\'s on its screen',
    '<code>/key 3 enter</code> · <code>/key 3 down down enter</code> · <code>/key 3 1</code> — answer prompts',
    '<code>/stop 3</code> — Esc (interrupt)',
    '<code>/wake 3</code> · <code>/sleep 3 [force]</code>',
    '<code>/new C:\\path [title]</code> — start a Claude session',
    '<code>/notify on|off</code> — ping me whenever any session finishes',
    '<code>/where</code> — show the current default target',
    '<code>/start</code> — in any chat: make this chat home (alerts + online notice come here; in a new group it registers it)',
    '<code>/commands</code> (or <code>/help</code>) — this list',
    'I auto-reply with the result when a session you messaged finishes.',
  ].join('\n');

  async function handle(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    try {
      if (text.startsWith('@')) {
        const m = text.match(/^@(\S+)\s+([\s\S]+)$/);
        if (!m) return T.out('Usage: <code>@3 your message</code>');
        const r = resolve(m[1]); if (r.error) return T.out(r.error);
        target = r.tab.id; return deliver(r.tab, m[2]);
      }
      if (!text.startsWith('/')) {
        const t = target && getTab(target);
        if (!t) return T.out('No default target. Send /list, then <code>/use 3</code> or <code>@3 message</code>.');
        return deliver(t, text);
      }
      const first = text.split(/\s+/)[0];
      const cmd = first.slice(1).split('@')[0].toLowerCase();
      const arg = text.slice(first.length).trim();
      switch (cmd) {
        case 'start': case 'help': case 'commands': case 'cmds': case 'command': return T.out(HELP);
        case 'list': case 'ls': case 'l': return T.out(listText());
        case 'use': case 'target': {
          const r = resolve(parseRef(arg).ref); if (r.error) return T.out(r.error);
          target = r.tab.id; return T.out(`🎯 Default target: <b>${label(r.tab)}</b>. Plain messages go there.`);
        }
        case 'where': return T.out(target && getTab(target) ? `🎯 ${label(getTab(target))}` : 'No default target.');
        case 'to': case 'send': case 'msg': {
          const { ref, rest } = parseRef(arg);
          if (!rest) return T.out('Usage: <code>/to 3 your message</code>');
          const r = resolve(ref); if (r.error) return T.out(r.error);
          target = r.tab.id; return deliver(r.tab, rest);
        }
        case 'peek': case 'screen': case 'tail': case 'p': {
          const { ref, rest } = parseRef(arg);
          const r = resolve(ref || (target ? '' : '')); const tab = ref ? r.tab : (target && getTab(target));
          if (!tab) return T.out(r.error || 'Which session?');
          const rt = R.get(tab.id);
          if (!rt || !rt.alive) return T.out(`💤 <b>${label(tab)}</b> is asleep. /wake ${snap.indexOf(tab.id) + 1}`);
          const n = Math.max(5, Math.min(120, parseInt(rest, 10) || 30));
          return T.out(`${ICON[stat(tab)]} <b>${label(tab)}</b>\n` + pre(screen(rt, null, n)));
        }
        case 'key': case 'keys': {
          const { ref, rest } = parseRef(arg);
          const r = resolve(ref); if (r.error) return T.out(r.error);
          const toks = rest.split(/\s+/).filter(Boolean);
          if (!toks.length) return T.out('Usage: <code>/key 3 enter</code>');
          return pressKeys(r.tab, toks);
        }
        case 'stop': case 'esc': case 'interrupt': {
          const r = resolve(parseRef(arg).ref || (target || '')); const tab = r.tab || (target && getTab(target));
          if (!tab) return T.out(r.error || 'Which session?');
          return pressKeys(tab, ['esc']);
        }
        case 'wake': case 'resume': {
          const r = resolve(parseRef(arg).ref); if (r.error) return T.out(r.error);
          const rt = R.get(r.tab.id);
          if (rt && rt.alive) return T.out(`🟢 <b>${label(r.tab)}</b> is already running.`);
          await startPty(r.tab); T.out(`☀️ Waking <b>${label(r.tab)}</b>…`);
          if (await waitReady(r.tab.id, 70000)) T.out(`🟢 <b>${label(r.tab)}</b> is ready.`); else T.out('⚠️ Still starting — /peek to check.');
          return;
        }
        case 'sleep': {
          const { ref, rest } = parseRef(arg);
          const r = resolve(ref); if (r.error) return T.out(r.error);
          const rt = R.get(r.tab.id);
          if (rt && (rt.working || rt.titleBusy) && !/force/i.test(rest)) return T.out(`🟠 <b>${label(r.tab)}</b> is working. <code>/sleep ${snap.indexOf(r.tab.id) + 1} force</code> to stop it anyway.`);
          sleepTab(r.tab.id); waiting.delete(r.tab.id); return T.out(`💤 <b>${label(r.tab)}</b> is asleep (resumable).`);
        }
        case 'new': {
          const { ref, rest } = parseRef(arg);
          if (!ref) return T.out('Usage: <code>/new C:\\path\\to\\project [title]</code>');
          if (!(await api.isDir(ref))) return T.out(`Folder not found: <code>${esc(ref)}</code>`);
          const prev = S.activeId;
          const tab = createTab({ title: rest.trim(), cwd: ref, kind: 'claude' });
          if (prev && getTab(prev)) activate(prev, { resume: false });
          refreshSnap();
          T.out(`🆕 Started <b>${label(tab)}</b>. Message it with <code>@${snap.indexOf(tab.id) + 1} …</code>`);
          return;
        }
        case 'notify': {
          const on = /^(on|1|yes|true)$/i.test(arg), off = /^(off|0|no|false)$/i.test(arg);
          if (on || off) { S.settings.tgNotifyAll = on; save(); }
          return T.out(`🔔 Finish alerts for all sessions: <b>${S.settings.tgNotifyAll ? 'on' : 'off'}</b>. (Sessions you message always reply.)`);
        }
        default: return T.out('Unknown command. /help');
      }
    } catch (e) { T.out('⚠️ ' + esc(e && e.message || e)); }
  }

  /* ---- replies when a messaged session finishes ---- */
  setInterval(() => {
    const now = Date.now();
    for (const [id, w] of waiting) {
      const rt = R.get(id), tab = getTab(id);
      if (!rt || !rt.alive || !tab) { waiting.delete(id); continue; }
      const busy = rt.working || rt.titleBusy;
      if (busy) w.saw = true;
      const quiet = !busy && now - rt.lastData > 2500;
      if (quiet && ((w.saw && now - w.since > 3000) || now - w.since > 7000)) {
        waiting.delete(id);
        T.out(`✅ <b>${label(tab)}</b>\n` + pre(screen(rt, w.msg, 45)));
      } else if (now - w.since > 25 * 60e3) {
        waiting.delete(id); T.out(`⏱ <b>${label(tab)}</b> is still going — /peek ${snap.indexOf(id) + 1}`);
      }
    }
  }, 1500);

  // Light, one-line ping (the full result is /peek N). Sessions you messaged get their own reply instead.
  window.tgOnNeeds = (id) => {
    const tab = getTab(id); if (!tab || !S.settings.tgNotifyAll) return;
    const i = snap.indexOf(id);
    T.out(`⚠️ <b>${esc(tab.title.slice(0, 44))}</b> is waiting for your answer${i >= 0 ? ` · /peek ${i + 1} · /key ${i + 1} 1 enter` : ' · /list'}`, true);
  };
  window.tgOnFinish = (id) => {
    const tab = getTab(id), rt = R.get(id);
    if (!tab || !rt || waiting.has(id) || !S.settings.tgNotifyAll) return;
    const i = snap.indexOf(id), sub = rt.liveTitle && rt.liveTitle !== tab.title ? ` — <i>${esc(rt.liveTitle.slice(0, 50))}</i>` : '';
    T.out(`✅ <b>${esc(tab.title.slice(0, 44))}</b> finished${sub}${i >= 0 ? ` · /peek ${i + 1}` : ' · /list'}`, true);
  };

  api.onTg((m) => handle(m.text));

  let hello = false;
  api.onTgStatus((st) => {
    if (!hello && st.running && st.paired && !st.error) {
      hello = true;
      setTimeout(() => T.out(`🟢 <b>Claude Deck is online</b> — ${S.tabs.filter((t) => R.get(t.id) && R.get(t.id).alive).length} live / ${S.tabs.length} sessions. /list`, true), 4000);
    }
  });

  /* ---- Settings UI ---- */
  function settingsSection() {
    const box = h('div');
    let st = null;
    const sw = (on, fn) => { const el = h('div', { class: 'switch' + (on ? ' on' : ''), onclick: () => { fn(!el.classList.contains('on')); el.classList.toggle('on'); } }); return el; };
    const row = (lbl, sub, ctl) => h('div', { class: 'setrow' }, h('div', { class: 'lbl' }, lbl, sub && h('small', null, sub)), ctl);
    const draw = () => {
      if (!st) return;
      const tok = h('input', { class: 'inp', type: 'password', placeholder: st.hasToken ? '•••••••• saved (paste a new one to replace)' : '123456789:AA…', spellcheck: 'false' });
      const saveBtn = h('button', { class: 'btn', onclick: async () => {
        if (!tok.value.trim()) return;
        const r = await api.tgSetToken(tok.value); tok.value = '';
        if (r.ok) { toast('Connected to @' + r.status.bot); } else toast('Token rejected: ' + r.error);
      } }, 'Save');
      const items = [
        h('div', { class: 'group-title' }, 'Telegram remote control'),
        row('Bot token', 'From @BotFather. Stored encrypted (Windows DPAPI), never shown here again.', h('div', { class: 'inline', style: 'width:300px' }, tok, saveBtn)),
        row('Remote control', st.hasToken ? (st.error ? '⚠️ ' + st.error : st.running ? `Online as @${st.bot}` : 'Off') : 'Add a token first', sw(st.enabled, (on) => { api.tgEnable(on); })),
      ];
      if (st.hasToken) {
        if (st.paired) {
          items.push(row('Paired account', `Only “${st.pairedName}” can control your sessions — in any chat, even groups.`, h('button', { class: 'btn danger', onclick: () => api.tgUnpair() }, 'Unpair')));
          items.push(row('Chats the bot answers in', (st.chats.length ? st.chats.map((c) => (c.home ? '🏠 ' : '') + c.title).join('  ·  ') : 'none yet') + '.  Type /start in any chat (or group) as yourself to add it and make it home.',
            h('button', { class: 'btn', onclick: () => api.tgPair() }, 'Add a group…')));
          if (st.groupCmd) items.push(row('Add to a group', 'If the bot is already in the group, paste this command there. Otherwise open the link and pick a group. Expires in 15 min.',
            h('div', { class: 'inline', style: 'width:300px' }, h('button', { class: 'btn', onclick: () => { api.writeClip(st.groupCmd); toast('Command copied — paste it in the group'); } }, 'Copy command'), h('button', { class: 'btn primary', onclick: () => api.openExternal(st.groupLink) }, 'Add to group…'))));
        } else if (st.pairLink) {
          items.push(row('Pair your Telegram', 'Private chat: open the link and press Start. Group: copy the command and paste it in the group where the bot already is. Expires in 15 min.',
            h('div', { class: 'inline', style: 'width:300px;flex-wrap:wrap' },
              h('button', { class: 'btn primary', onclick: () => api.openExternal(st.pairLink) }, 'Open in Telegram'),
              h('button', { class: 'btn', onclick: () => { api.writeClip(st.groupCmd); toast('Command copied — paste it in your group'); } }, 'Copy group command'),
              h('button', { class: 'btn', onclick: () => { api.writeClip(st.pairLink); toast('Link copied'); } }, 'Copy link'))));
        } else {
          items.push(row('Pair your Telegram', 'Until paired, the bot ignores everyone. Works for a private chat or a group.', h('button', { class: 'btn primary', onclick: () => api.tgPair() }, 'Generate pairing code')));
        }
        items.push(row('Ping me on Telegram when a session finishes all its work', 'One short line to your home chat. Sessions you message always reply on their own.', sw(!!S.settings.tgNotifyAll, (on) => { S.settings.tgNotifyAll = on; save(); })));
      }
      box.replaceChildren(...items);
    };
    api.tgStatus().then((s) => { st = s; draw(); });
    const off = api.onTgStatus((s) => { if (!box.isConnected) { off(); return; } st = s; draw(); });
    return box;
  }
  window.tgSettingsSection = settingsSection;

  return Object.assign(T, { handle, groups });
})();
window.__tg = TG;
