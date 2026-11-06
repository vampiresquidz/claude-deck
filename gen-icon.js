'use strict';
// One-off: renders build/icon.png + build/icon.ico.  Run: node_modules\electron\dist\electron.exe gen-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e98a6a"/><stop offset="1" stop-color="#c4553a"/></linearGradient></defs>
<rect x="12" y="12" width="232" height="232" rx="58" fill="#0f1218"/>
<rect x="12" y="12" width="232" height="232" rx="58" fill="none" stroke="#2a3040" stroke-width="3"/>
<rect x="44" y="64" width="168" height="128" rx="22" fill="#171b25" stroke="#2a3040" stroke-width="3"/>
<circle cx="66" cy="86" r="6" fill="#f06a6a"/><circle cx="86" cy="86" r="6" fill="#f2b84b"/><circle cx="106" cy="86" r="6" fill="#3ecf8e"/>
<path d="M78 118l32 22-32 22" fill="none" stroke="url(#g)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M128 168h46" stroke="url(#g)" stroke-width="14" stroke-linecap="round"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${SVG}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const png = (await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })).toPNG();
  const dir = path.join(__dirname, 'build');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  // PNG-in-ICO (Vista+): 6-byte header + 16-byte dir entry + PNG
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, png]));
  console.log('icon written', png.length);
  app.quit();
});
