'use strict';
// Headless-ish end-to-end check: boots the real app in smoke mode and asserts the main features.
const { spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const out = path.join(os.tmpdir(), 'claudedeck-test-out');
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(path.join(os.tmpdir(), 'claudedeck-smoke'), { recursive: true, force: true });
const electron = require('electron');
spawnSync(electron, ['.'], { cwd: path.join(__dirname, '..'), env: { ...process.env, CT_SMOKE: '1', CT_SMOKE_PHASE: 'extras', CT_SMOKE_OUT: out }, timeout: 120000, stdio: 'ignore' });
let log = ''; try { log = fs.readFileSync(path.join(out, 'log.txt'), 'utf8'); } catch { /* none */ }
const checks = [
  ['app boots', /boot ok/],
  ['folder look applies wallpaper + accent', /look applied: bg=aurora accent=teal/],
  ['attention inbox detects a prompt', /attn flag: true/],
  ['split view shows two panes', /split-l[^\n]*split-r/],
  ['no renderer errors', (l) => !/renderer-error|FAILED/.test(l)],
];
let bad = 0;
for (const [name, t] of checks) {
  const ok = typeof t === 'function' ? t(log) : t.test(log);
  console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
