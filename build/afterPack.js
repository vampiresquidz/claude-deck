'use strict';
// Embeds the app icon into the exe (electron-builder's own step needs symlink privileges on some Windows setups).
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(ctx) {
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  let rcedit = null;
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) { const p = path.join(cache, d, 'rcedit-x64.exe'); if (fs.existsSync(p)) { rcedit = p; break; } }
  if (!rcedit) { console.log('  • rcedit not found, leaving default exe icon'); return; }
  execFileSync(rcedit, [exe, '--set-icon', path.join(__dirname, 'icon.ico'), '--set-version-string', 'ProductName', 'Claude Deck', '--set-version-string', 'FileDescription', 'Claude Deck']);
  console.log('  • icon embedded in', path.basename(exe));
};
