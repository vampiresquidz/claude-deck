'use strict';
// Custom AI wallpapers: prompt -> headless `claude -p` (uses your Claude login + Higgsfield connector) -> mp4 -> looped clip in userData.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

class Wallpapers {
  constructor(dataDir, emit) {
    this.dir = path.join(dataDir, 'wallpapers'); this.idx = path.join(this.dir, 'index.json'); this.emit = emit; this.busy = null;
    fs.mkdirSync(this.dir, { recursive: true });
  }
  _read() { try { return JSON.parse(fs.readFileSync(this.idx, 'utf8')); } catch { return []; } }
  _write(a) { fs.writeFileSync(this.idx, JSON.stringify(a, null, 1)); }
  list() {
    return this._read().filter((w) => fs.existsSync(path.join(this.dir, w.id + '.mp4'))).map((w) => ({
      key: 'custom-' + w.id, id: w.id, name: w.name, prompt: w.prompt, kind: 'ai', custom: true,
      file: pathToFileURL(path.join(this.dir, w.id + '.mp4')).href,
      poster: fs.existsSync(path.join(this.dir, w.id + '.jpg')) ? pathToFileURL(path.join(this.dir, w.id + '.jpg')).href : '',
    }));
  }
  remove(id) {
    for (const e of ['.mp4', '.jpg']) { try { fs.unlinkSync(path.join(this.dir, id + e)); } catch { /* ignore */ } }
    this._write(this._read().filter((w) => w.id !== id)); return true;
  }
  _ffmpeg() {
    for (const c of [process.env.FFMPEG, 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'ffmpeg']) {
      if (!c) continue;
      try { if (spawnSync(c, ['-version'], { windowsHide: true }).status === 0) return c; } catch { /* next */ }
    }
    return null;
  }
  cancel() { if (this.busy && this.busy.child) { try { this.busy.child.kill(); } catch { /* ignore */ } } }
  generate(prompt) {
    if (this.busy) return Promise.resolve({ ok: false, error: 'A wallpaper is already being generated.' });
    prompt = String(prompt || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, 300);
    if (!prompt) return Promise.resolve({ ok: false, error: 'Describe the wallpaper first.' });
    const id = Date.now().toString(36);
    const full = 'Pixel-art animated wallpaper, chunky square pixels, ' + prompt + ', locked static camera, calm gentle seamless loop, no text';
    const task = 'Use the Higgsfield tools. Call mcp__claude_ai_Higgsfield__generate_video exactly once with params {"model":"kling3_0_turbo","prompt":' + JSON.stringify(full) + ',"aspect_ratio":"16:9","duration":5}. Then call mcp__claude_ai_Higgsfield__jobs_wait with the returned job id (timeout_seconds 15) repeatedly until the job is completed or failed. Do not call any other tool and do not generate anything else. When completed, reply with ONLY one line: RESULT_URL=<the result_url>. If it failed, reply with ONLY: FAILED <reason>.';
    const st = (m) => this.emit('wp:progress', { id, msg: m });
    return new Promise((resolve) => {
      st('Asking Claude to generate…');
      const child = spawn('claude', ['-p', task, '--allowedTools', 'mcp__claude_ai_Higgsfield__generate_video,mcp__claude_ai_Higgsfield__jobs_wait', '--output-format', 'text'], { windowsHide: true, cwd: this.dir });
      this.busy = { id, child };
      let out = '', err = '';
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 12 * 60 * 1000);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const done = (r) => { clearTimeout(timer); this.busy = null; resolve(r); };
      child.on('error', (e) => done({ ok: false, error: 'Could not run claude: ' + e.message }));
      child.on('close', async () => {
        const m = /RESULT_URL=(https:\/\/\S+?\.mp4)/.exec(out);
        if (!m) return done({ ok: false, error: (/FAILED[^\n]*/.exec(out) || [out.trim().slice(-300) || err.trim().slice(-300) || 'No video came back (is the Higgsfield connector enabled in Claude?)'])[0] });
        try {
          st('Downloading…');
          const res = await fetch(m[1]); if (!res.ok) throw new Error('download ' + res.status);
          const raw = path.join(this.dir, id + '.raw.mp4'); fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
          const final = path.join(this.dir, id + '.mp4'), ff = this._ffmpeg();
          if (ff) {
            st('Making a seamless loop…');
            const a = spawnSync(ff, ['-y', '-loglevel', 'error', '-i', raw, '-an', '-vf', 'scale=1280:-2,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', final], { windowsHide: true });
            spawnSync(ff, ['-y', '-loglevel', 'error', '-i', raw, '-vframes', '1', '-vf', 'scale=480:-2', '-q:v', '4', path.join(this.dir, id + '.jpg')], { windowsHide: true });
            if (a.status !== 0) fs.copyFileSync(raw, final);
          } else fs.copyFileSync(raw, final);
          try { fs.unlinkSync(raw); } catch { /* ignore */ }
          const name = prompt.length > 22 ? prompt.slice(0, 21) + '…' : prompt;
          this._write(this._read().concat([{ id, name, prompt, at: Date.now() }]));
          done({ ok: true, item: this.list().find((w) => w.id === id) });
        } catch (e) { done({ ok: false, error: e.message }); }
      });
    });
  }
}
module.exports = { Wallpapers };
