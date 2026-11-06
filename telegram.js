'use strict';
// Telegram bridge (main process). The bot token is stored encrypted with Windows DPAPI (Electron safeStorage)
// and never leaves this process. Only one paired private chat is ever accepted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class Telegram {
  constructor(dir, safeStorage, emit) {
    this.file = path.join(dir, 'telegram.json');
    this.ss = safeStorage;
    this.emit = emit || (() => {});
    this.cfg = { tokenEnc: null, bot: null, botId: null, enabled: false, userId: null, name: null, chats: [], primary: null, chatInfo: {} };
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first run */ }
    if (this.cfg.chatId && !this.cfg.chats.length) { this.cfg.chats = [this.cfg.chatId]; this.cfg.primary = this.cfg.chatId; } // migrate v1 config
    delete this.cfg.chatId;
    this.replyChat = null;
    this.runId = 0; this.running = false; this.error = null; this.offset = 0;
    this.pairCode = null; this.pairExp = 0; this.ac = null;
  }

  _save() { const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(this.cfg)); fs.renameSync(t, this.file); }
  _token() {
    if (!this.cfg.tokenEnc) return null;
    try { return this.ss.decryptString(Buffer.from(this.cfg.tokenEnc, 'base64')); } catch { return null; }
  }

  async _api(method, body, signal, token) {
    const tok = token || this._token();
    if (!tok) throw new Error('No bot token set');
    let res;
    try {
      res = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal });
    } catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Network error reaching Telegram'); } // never echo URL (contains token)
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || 'Telegram error ' + res.status);
    return j.result;
  }

  status() {
    const valid = this.pairCode && Date.now() < this.pairExp;
    return {
      hasToken: !!this.cfg.tokenEnc, bot: this.cfg.bot, enabled: !!this.cfg.enabled, running: this.running, error: this.error,
      paired: !!this.cfg.userId, pairedName: this.cfg.name,
      chats: this.cfg.chats.map((id) => ({ id, title: this.cfg.chatInfo[id] || 'Chat', home: id === this.cfg.primary })),
      pairCode: valid ? this.pairCode : null, pairLink: valid && this.cfg.bot ? `https://t.me/${this.cfg.bot}?start=${this.pairCode}` : null,
      groupLink: valid && this.cfg.bot ? `https://t.me/${this.cfg.bot}?startgroup=${this.pairCode}` : null,
      groupCmd: valid && this.cfg.bot ? `/start@${this.cfg.bot} ${this.pairCode}` : null,
    };
  }
  _changed() { this.emit('status', this.status()); }

  async setToken(token) {
    token = String(token || '').trim();
    if (!/^\d{6,12}:[\w-]{30,}$/.test(token)) throw new Error('That does not look like a bot token');
    if (!this.ss.isEncryptionAvailable()) throw new Error('Windows secure storage unavailable');
    const me = await this._api('getMe', {}, null, token);
    const changedBot = this.cfg.botId && this.cfg.botId !== me.id;
    this.cfg.tokenEnc = this.ss.encryptString(token).toString('base64');
    this.cfg.bot = me.username; this.cfg.botId = me.id;
    if (changedBot) this._clearPairing();
    this._save(); this.error = null;
    if (this.cfg.enabled) { this.stop(); this.start(); }
    this._changed();
    return this.status();
  }

  setEnabled(on) {
    this.cfg.enabled = !!on; this._save();
    if (on) this.start(); else this.stop();
    this._changed();
  }

  newPair() {
    this.pairCode = crypto.randomBytes(5).toString('hex'); this.pairExp = Date.now() + 15 * 60e3;
    this._changed(); return this.status();
  }
  _clearPairing() { this.cfg.userId = null; this.cfg.name = null; this.cfg.chats = []; this.cfg.primary = null; this.cfg.chatInfo = {}; this.replyChat = null; }
  unpair() { this._clearPairing(); this.pairCode = null; this._save(); this._changed(); }

  stop() { this.runId++; this.running = false; try { this.ac && this.ac.abort(); } catch { /* ignore */ } }

  start() {
    if (this.running || !this.cfg.enabled || !this._token()) return;
    this._loop();
  }

  async _loop() {
    const my = ++this.runId; this.running = true; this._changed();
    try {
      // Drop anything queued while we were offline: stale commands must never run after a reboot.
      const ups = await this._api('getUpdates', { offset: -1, timeout: 0 });
      if (ups.length) this.offset = ups[ups.length - 1].update_id + 1;
      await this._api('setMyCommands', { commands: [
        { command: 'list', description: 'List all sessions' }, { command: 'use', description: 'Set default target: /use 3' },
        { command: 'to', description: 'Message a session: /to 3 text' }, { command: 'peek', description: 'See a session screen: /peek 3' },
        { command: 'key', description: 'Press keys: /key 3 esc | enter | 1' }, { command: 'stop', description: 'Interrupt a session (Esc)' },
        { command: 'wake', description: 'Resume a sleeping session' }, { command: 'sleep', description: 'Put a session to sleep' },
        { command: 'new', description: 'Start a session in a folder' }, { command: 'notify', description: 'Alerts on/off' }, { command: 'where', description: 'Show the current default target' },
        { command: 'commands', description: 'Show all commands' }, { command: 'help', description: 'Show all commands' }] }).catch(() => {});
      this.error = null; this._changed();
    } catch (e) { if (this.runId !== my) return; this.error = e.message; this._changed(); }
    while (this.runId === my && this.cfg.enabled) {
      try {
        this.ac = new AbortController();
        const ups = await this._api('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, this.ac.signal);
        if (this.error) { this.error = null; this._changed(); }
        for (const u of ups) { this.offset = u.update_id + 1; this._handle(u); }
      } catch (e) {
        if (this.runId !== my) break;
        if (e && e.name === 'AbortError') break;
        this.error = e.message; this._changed();
        await sleep(e.message.includes('Conflict') ? 15000 : 5000);
      }
    }
    if (this.runId === my) { this.running = false; this._changed(); }
  }

  _fromName(f) { return [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || 'you'; }
  _chatName(chat) { return chat.type === 'private' ? 'Private chat' : (chat.title || 'Group'); }

  _handle(u) {
    const m = u.message;
    if (!m || typeof m.text !== 'string' || !m.chat || !m.from) return;
    const kind = m.chat.type;
    if (kind !== 'private' && kind !== 'group' && kind !== 'supergroup') return;
    if (Date.now() / 1000 - m.date > 120) return; // stale
    const c = this.cfg, cid = m.chat.id, isGroup = kind !== 'private';
    // Commands addressed to some other bot in a group are not for us.
    const addr = m.text.match(/^\/\w+@(\w+)/);
    if (addr && c.bot && addr[1].toLowerCase() !== c.bot.toLowerCase()) return;
    const text = m.text.replace(/^(\/\w+)@\w+/, '$1').trim();

    if (c.userId) {
      if (m.from.id !== c.userId) return;            // only the owner, in any chat; everyone else is ignored silently
      if (!c.chats.includes(cid)) {
        if (/^\/start\s*$/i.test(text)) this._register(m.chat, true); // owner says /start in a new chat → register it
        return;
      }
      this.replyChat = cid;
      if (/^\/start\s*$/i.test(text) && c.primary !== cid) {
        c.primary = cid; this._save(); this._changed();
        this.send(`📍 <b>Home set to ${this._esc(c.chatInfo[cid] || this._chatName(m.chat))}.</b> Alerts and the online notice will come here.`, cid).catch(() => {});
      }
      this.emit('message', { text });
      return;
    }

    // Not paired yet: only a valid one-time code (typed in a private chat or in a group) can pair.
    const mm = text.match(/^\/start\s+([0-9a-f]{10})\s*$/i);
    if (!mm || !this.pairCode || Date.now() >= this.pairExp) return;
    const a = Buffer.from(mm[1].toLowerCase()), b = Buffer.from(this.pairCode);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return;
    c.userId = m.from.id; c.name = this._fromName(m.from);
    this.pairCode = null;
    this._register(m.chat, false);
    this.send(`✅ <b>Paired with ${this._esc(c.name)}.</b> Only you can control Claude Deck${isGroup ? ', even in this group' : ''}.\nSend /list to see your sessions, /commands for everything I can do.`, cid).catch(() => {});
  }

  _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  _register(chat, announce) {
    const c = this.cfg, cid = chat.id;
    if (!c.chats.includes(cid)) c.chats.push(cid);
    c.chatInfo[cid] = this._chatName(chat);
    c.primary = cid; this.replyChat = cid;
    this._save(); this._changed();
    if (announce) {
      const grp = chat.type !== 'private';
      this.send(`✅ <b>Registered ${this._esc(c.chatInfo[cid])}</b> (chat id <code>${cid}</code>) and made it home. Only ${this._esc(c.name || 'you')} can command me here.` +
        (grp ? '\n\nℹ️ In groups I only see /commands unless privacy mode is off (BotFather → /setprivacy → Disable). Use <code>/to 3 message</code> — or turn privacy off to use <code>@3 message</code> and plain text after <code>/use</code>.' : '') + '\n\n/commands for the full list.', cid).catch(() => {});
    }
  }

  // chatId: explicit chat; home=true → the primary chat (alerts); otherwise the chat that last talked to us.
  async send(html, chatId, home) {
    const c = this.cfg;
    const to = chatId || (home ? c.primary : (this.replyChat || c.primary));
    if (!to || !c.chats.includes(to) || !this._token()) return;
    const chunks = [];
    let rest = String(html);
    while (rest.length > 3900) {
      let cut = rest.lastIndexOf('\n', 3900); if (cut < 1500) cut = 3900;
      chunks.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
    chunks.push(rest);
    for (const part of chunks) {
      try { await this._api('sendMessage', { chat_id: to, text: part, parse_mode: 'HTML', disable_web_page_preview: true }); }
      catch { try { await this._api('sendMessage', { chat_id: to, text: stripTags(part) }); } catch { /* give up */ } }
    }
  }
}

module.exports = { Telegram };
