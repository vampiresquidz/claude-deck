'use strict';
// Headless-ish smoke test: node_modules\.bin\electron . with CT_SMOKE=1
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = (getWin, ptys) => {
  const out = process.env.CT_SMOKE_OUT || path.join(os.tmpdir(), 'claudedeck-smoke');
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => { const s = a.join(' '); console.log('[smoke]', s); fs.appendFileSync(path.join(out, 'log.txt'), s + '\n'); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.writeFileSync(path.join(out, 'log.txt'), '');

  (async () => {
    const win = getWin();
    win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) log('renderer-error:', msg); });
    win.webContents.on('render-process-gone', (_e, d) => log('render gone', JSON.stringify(d)));
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    await sleep(800);
    const ev = (code) => win.webContents.executeJavaScript(code);
    try {
      log('boot ok, tabs=', await ev('__deck.S.tabs.length'));
      if (process.env.CT_SMOKE_PHASE === 'wp') {
        const wp = require('fs').readdirSync(process.env.WPDIR).find((f) => f.endsWith('.mp4')).replace('.mp4', '');
        const base = require('url').pathToFileURL(process.env.WPDIR).href;
        await ev(`BGFX.register([{ key: 'custom-${wp}', id: '${wp}', name: 'koi pond test', kind: 'ai', custom: true, file: '${base}/${wp}.mp4', poster: '${base}/${wp}.jpg' }]); __deck.setSetting('bgTheme', 'custom-${wp}'); 0`);
        await sleep(2500);
        let im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'wp-main.png'), im.toPNG());
        await ev('__deck.settingsModal()'); await sleep(400);
        await ev(`document.querySelector('.modal .m-body').scrollTop = 420`); await sleep(300);
        im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'wp-settings.png'), im.toPNG());
        await ev(`document.querySelector('.wp-add').click()`); await sleep(500);
        im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'wp-modal.png'), im.toPNG());
        setTimeout(() => process.exit(0), 200); return;
      }
      if (process.env.CT_SMOKE_PHASE === 'fx') {
        await ev(`__deck.createTab({ title: 'Demo', cwd: ${JSON.stringify(os.homedir())}, kind: 'shell' })`); await sleep(1500);
        await ev(`(() => { const d = __deck; const f = d.newFolder(null, 'Work'); const f2 = d.newFolder(f.id, 'Client A'); const g = d.newFolder(null, 'Side projects');
          d.createTab({ title: 'API refactor', cwd: ${JSON.stringify(os.homedir())}, kind: 'shell', folderId: f2.id }); d.createTab({ title: 'Landing page', cwd: ${JSON.stringify(os.homedir())}, kind: 'shell', folderId: g.id }); })()`); await sleep(2500);
        for (const k of ['moonlit', 'fireflies', 'jellyfish', 'matrix', 'aurora', 'sun', 'clouds', 'ai-moon', 'ai-deep', 'ai-sunset']) {
          await ev(`__deck.setSetting('bgTheme', '${k}')`); await sleep(k.startsWith('ai') ? 1800 : 1200);
          const im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'fx-' + k + '.png'), im.toPNG());
        }
        await ev('__deck.settingsModal()'); await sleep(400);
        const im2 = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'fx-settings.png'), im2.toPNG());
        setTimeout(() => process.exit(0), 200); return;
      }
      if (process.env.CT_SMOKE_PHASE === 'ping') {
        // Simulate Claude's busy spinner via the terminal title (braille = busy, ✳ = idle) on a background tab.
        await ev(`(() => { const d = __deck; d.createTab({ title: 'A', cwd: ${JSON.stringify(os.homedir())}, kind: 'shell' }); d.createTab({ title: 'B', cwd: ${JSON.stringify(os.homedir())}, kind: 'shell' }); window.__pings = []; window.tgOnFinish = (id) => window.__pings.push(d.getTab(id).title); })()`);
        await sleep(4000);
        const setTitle = (name, busy) => ev(`(() => { const d = __deck; const t = d.S.tabs.find(x => x.title === '${name}'); d.R.get(t.id).term.write('\\x1b]0;' + (${busy} ? '\\u280B working' : '\\u2733 idle') + '\\x07'); 0 })()`);
        const pings = async () => JSON.parse(await ev('JSON.stringify(window.__pings)'));
        // B is active (last created). A is in the background.
        log('1) trivial 2s blip on A → expect NO ping');
        await setTitle('A', true); await sleep(2000); await setTitle('A', false); await sleep(9000);
        log('   pings:', JSON.stringify(await pings()));
        log('2) A works 4s, pauses 3s, works 4s, then finishes → expect exactly ONE ping, ~6s after the end');
        await setTitle('A', true); await sleep(4000); await setTitle('A', false); await sleep(3000);
        await setTitle('A', true); await sleep(4000); const tEnd = Date.now(); await setTitle('A', false);
        await sleep(3500); log('   3.5s after finish, pings:', JSON.stringify(await pings()), '(mid-pause must not have pinged)');
        await sleep(6000); log('   9.5s after finish, pings:', JSON.stringify(await pings()));
        log('   dot state:', await ev(`(() => { const d = __deck; const t = d.S.tabs.find(x => x.title === 'A'); return d.R.get(t.id).unread })()`));
        setTimeout(() => process.exit(0), 200); return;
      }
      if (process.env.CT_SMOKE_PHASE === 'restore') {
        log('open-flagged tabs from previous run:', await ev('__deck.S.tabs.filter(t => t.open).map(t => t.title).join(", ")'));
        await ev('__deck.restoreModal(__deck.S.tabs.filter(t => t.open), true)'); await sleep(500);
        let im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'restore2.png'), im.toPNG());
        await ev(`[...document.querySelectorAll('.m-foot .btn')].find(b => b.textContent === 'Resume selected').click()`);
        await sleep(9000);
        log('ptys after restore:', ptys.size);
        im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'restored.png'), im.toPNG());
        setTimeout(() => process.exit(0), 200); return;
      }
      await ev(`(() => { const d = __deck; const f = d.newFolder(null, 'Work'); const f2 = d.newFolder(f.id, 'Client A'); const g = d.newFolder(null, 'Side projects');
        d.createTab({ title: 'API refactor', cwd: process_cwd, kind: 'shell', folderId: f2.id });
        d.createTab({ title: 'Landing page', cwd: process_cwd, kind: 'shell', folderId: g.id });
        d.createTab({ title: 'Scratch', cwd: process_cwd, kind: 'shell' }); })()`.replace(/process_cwd/g, JSON.stringify(os.homedir())));
      await sleep(2500);
      const id = await ev('__deck.S.activeId');
      ptys.forEach((e, k) => e.p.write('echo SMOKE_OK_' + 1234 + '\r'));
      await sleep(1500);
      const txt = await ev(`(() => { const rt = __deck.R.get(__deck.S.activeId); const b = rt.term.buffer.active; let s=''; for (let i=0;i<b.length;i++){ const l=b.getLine(i); if(l) s+=l.translateToString(true)+'\\n'; } return s; })()`);
      log('echo seen in xterm:', /SMOKE_OK_1234/.test(txt));
      log('live ptys:', ptys.size);
      // --- Telegram command layer (output captured instead of sent) ---
      await ev(`window.__cap = []; __tg.out = (h) => window.__cap.push(h); 0`);
      const tgSay = async (t, wait) => { await ev(`__tg.handle(${JSON.stringify(t)})`); await sleep(wait || 700); };
      await tgSay('/list');
      await tgSay('/to 3 echo HELLO_FROM_TELEGRAM', 9000);
      await tgSay('@api echo second_target_ok', 9000);
      await tgSay('/peek 3 8');
      await tgSay('/key 3 e c h o space k enter');
      await tgSay('/sleep 2');
      await tgSay('/to 2 echo woke_by_message', 14000);
      await tgSay('/use landing');
      await tgSay('/bogus');
      const cap = await ev('window.__cap');
      log('=== TELEGRAM TRANSCRIPT ===\n' + cap.map((c, i) => `[${i}] ` + c.replace(/<[^>]+>/g, '')).join('\n---\n'));
      await ev(`__tg.out = (h) => window.api.tgSend(h); 0`);
      // --- real Claude resume test: reuse an existing session id from history ---
      const sessions = await ev('window.api.listSessions()');
      log('history sessions found:', sessions.length);
      if (sessions.length) {
        const s = sessions[sessions.length > 3 ? 3 : 0];
        log('resuming session', s.id, 'in', s.cwd, '—', s.title.slice(0, 60));
        await ev(`__deck.createTab({ title: 'RESUME TEST', cwd: ${JSON.stringify(s.cwd)}, kind: 'claude', sessionId: ${JSON.stringify(s.id)} })`);
        await sleep(9000);
        const t = await ev(`(() => { const rt = __deck.R.get(__deck.S.activeId); const b = rt.term.buffer.active; let s=''; for (let i=0;i<b.length;i++){ const l=b.getLine(i); if(l) s+=l.translateToString(true)+'\\n'; } return s; })()`);
        log('--- claude tab output ---\n' + t.trim().slice(0, 1500));
        let im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'claude.png'), im.toPNG());
      }
      await ev(`__deck.restoreModal(__deck.S.tabs.filter(t => !__deck.R.get(t.id)), false)`); await sleep(400);
      { const im = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'restore.png'), im.toPNG()); }
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
      await sleep(3000);
      log('states:', await ev(`JSON.stringify([...__deck.R].map(([id, r]) => ({ w: r.working, u: r.unread, tb: r.titleBusy, age: Date.now() - r.lastData, title: r.liveTitle })))`));
      log('palette:', await ev(`(() => { try { __deck.paletteModal(); return document.querySelectorAll('.backdrop').length; } catch (e) { return 'ERR ' + e.stack; } })()`)); await sleep(500);
      let img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'palette.png'), img.toPNG());
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
      await ev('__deck.settingsModal()'); await sleep(300);
      img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'settings.png'), img.toPNG());
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
      await ev('__deck.newSessionModal()'); await sleep(300);
      img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'new.png'), img.toPNG());
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
      img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, 'main.png'), img.toPNG());
      log('screenshots saved to', out);
    } catch (e) { log('FAILED', e && e.stack || e); }
    setTimeout(() => process.exit(0), 300);
  })();
};
