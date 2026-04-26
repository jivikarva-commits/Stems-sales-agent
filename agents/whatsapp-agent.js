'use strict';

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const nodeCrypto = require('crypto');
const P = require('pino');
const QRCode = require('qrcode');

if (!globalThis.crypto && nodeCrypto.webcrypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
require('dotenv').config();

const REQUIRED_ENV = ['CLAUDE_API_KEY', 'MONGODB_URI'];
REQUIRED_ENV.forEach((k) => {
  if (!process.env[k]) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
});

const AGENT_NAME = 'Stems Sales Agent';
const DEFAULT_OWNER = (process.env.PRIMARY_OWNER_EMAIL || 'samerkarwande3@gmail.com').trim().toLowerCase();
const OWNER_HEADER = 'x-owner-email';

// FIX: Define SESSIONS_DIR — was missing, causing silent crash on auth write
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });


function ownerScope(ownerEmail, extra = {}) {
  const owner = (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase();
  return { ...extra, owner_email: owner, user_id: owner };
}

const conversationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  messageId: String,
  owner_email: { type: String, index: true, default: DEFAULT_OWNER },
  user_id: { type: String, index: true, default() { return this.owner_email || DEFAULT_OWNER; } },
  timestamp: { type: Date, default: Date.now, index: true },
});

const userProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: String,
  pushName: String,           // FIX 3: WhatsApp display name (Bio/notify name)
  budget: String,
  location: String,
  purpose: String,
  leadScore: { type: Number, default: 0 },
  status: { type: String, enum: ['new', 'qualified', 'hot', 'cold', 'converted'], default: 'new' },
  marketingOptOut: { type: Boolean, default: false },
  // FIX 2: Active conversation tracking — once keyword triggers reply,
  // contact is "active" and gets all subsequent messages until timeout/closed.
  activeConversation: { type: Boolean, default: false },
  activeSince: Date,
  lastReplyAt: Date,
  conversationClosed: { type: Boolean, default: false },
  tags: [String],
  owner_email: { type: String, index: true, default: DEFAULT_OWNER },
  user_id: { type: String, index: true, default() { return this.owner_email || DEFAULT_OWNER; } },
  lastInteraction: Date,
  createdAt: { type: Date, default: Date.now },
});

// FIX 1: Per-owner session start tracking — stored to ignore old messages after re-login
const sessionStartSchema = new mongoose.Schema({
  owner_email: { type: String, required: true, unique: true, index: true },
  session_started_at: { type: Date, required: true },
  updated_at: { type: Date, default: Date.now },
});

const SessionStart = mongoose.model('SessionStart', sessionStartSchema);

conversationSchema.index({ owner_email: 1, user_id: 1, userId: 1, timestamp: -1 });
userProfileSchema.index({ owner_email: 1, user_id: 1, userId: 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);
const UserProfile = mongoose.model('UserProfile', userProfileSchema);


class SalesAgent {
  constructor() {
    this.claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  }

  async chat(ownerEmail, userId, userMessage) {
    await this._extractAndUpdateProfile(ownerEmail, userId, userMessage);
    const scope = ownerScope(ownerEmail, { userId });
    const ownerKey = (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase();

    let history = [];
    let profile = {};
    let account = null;
    let agentConfig = null;

    try {
      [history, profile, account, agentConfig] = await Promise.all([
        Conversation.find(scope).sort({ timestamp: -1 }).limit(20).lean()
          .then((m) => m.reverse()).catch(() => []),
        UserProfile.findOne(scope).lean().catch(() => ({})),
        mongoose.connection.collection('users').findOne(
          { email: ownerKey },
          { projection: { agent_name: 1, business_name: 1, business_description: 1 } }
        ).catch(() => null),
        // Per-user agent config (fully custom prompt) — null is OK
        mongoose.connection.collection('agent_configs').findOne(
          { owner_email: ownerKey }
        ).catch(() => null),
      ]);
    } catch (e) {
      console.error('[WA] chat() data fetch failed:', e?.message);
    }

    // Defensive defaults so we NEVER crash on null
    const safeAccount = account || {};
    const safeProfile = profile || {};
    const safeHistory = Array.isArray(history) ? history : [];

    const response = await this.claude.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.7,
      system: this._buildPrompt(safeProfile, safeAccount, agentConfig),
      messages: [
        ...safeHistory.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage },
      ],
    });
    return response.content[0].text;
  }

  _buildPrompt(profile, account, agentConfig) {
    // Priority 1: Use the user's CUSTOM agent_config (fully their own description)
    if (agentConfig && agentConfig.agent_description && agentConfig.agent_description.trim()) {
      const name = (agentConfig.agent_name || account?.agent_name || 'Assistant').trim();
      return `You are ${name}.

${agentConfig.agent_description.trim()}

Behavior rules:
- Reply naturally and concisely as a human would.
- Match the user's language (Hindi/Hinglish/English).
- Never reveal you are an AI or bot.
- Ask one focused question at a time.

Known about this contact:
- Budget: ${profile?.budget || 'unknown'}
- Location: ${profile?.location || 'unknown'}
- Purpose: ${profile?.purpose || 'unknown'}`;
    }

    // Priority 2: Fallback to onboarding profile in users collection
    const agentName = (account?.agent_name || 'Assistant').trim();
    const businessName = (account?.business_name || '').trim();
    const businessDescription = (account?.business_description || '').trim();

    if (businessName || businessDescription) {
      return `You are ${agentName} from ${businessName || 'this business'}.
${businessDescription}
Reply concisely and naturally. Match the user's language. Never say you are an AI.
Known: budget=${profile?.budget || '?'}, location=${profile?.location || '?'}, purpose=${profile?.purpose || '?'}`;
    }

    // Priority 3: Generic safe fallback (no hardcoded "Sam from Kissht")
    return `You are ${agentName}, a helpful assistant.
Reply briefly and naturally. Match the user's language. Never say you are an AI.`;
  }

  async _extractAndUpdateProfile(ownerEmail, userId, message) {
    const updates = {};
    const budgetMatch = message.match(/(\d[\d.]*)\s*(lakh|lakhs|lac|cr|crore|L|C)\b/i);
    if (budgetMatch) updates.budget = budgetMatch[0];
    const cities = ['mumbai','delhi','bangalore','bengaluru','gurgaon','gurugram','noida','pune','hyderabad','chennai','kolkata'];
    const hit = cities.find((c) => message.toLowerCase().includes(c));
    if (hit) updates.location = hit;
    if (/invest|rental|yield/i.test(message)) updates.purpose = 'investment';
    else if (/family|self.?use|stay|living|ghar|khud/i.test(message)) updates.purpose = 'self-use';
    if (Object.keys(updates).length) {
      updates.lastInteraction = new Date();
      await UserProfile.findOneAndUpdate(ownerScope(ownerEmail, { userId }), { $set: updates }, { upsert: true });
    }
  }

  async _updateLeadScore(ownerEmail, userId) {
    const [profile, msgCount] = await Promise.all([
      UserProfile.findOne(ownerScope(ownerEmail, { userId })).lean(),
      Conversation.countDocuments(ownerScope(ownerEmail, { userId })),
    ]);
    if (!profile) return;
    let score = 0;
    if (profile.budget) score += 20;
    if (profile.location) score += 15;
    if (profile.purpose) score += 10;
    score += Math.min(msgCount * 2, 30);
    const recent = await Conversation.find(ownerScope(ownerEmail, { userId, role: 'user' }))
      .sort({ timestamp: -1 }).limit(5).lean();
    if (recent.some((m) => /visit|demo|call|schedule|book/i.test(m.content))) score += 25;
    await UserProfile.findOneAndUpdate(ownerScope(ownerEmail, { userId }), { $set: { leadScore: Math.min(score, 100) } });
  }

  async refreshLeadScore(ownerEmail, userId) {
    try { await this._updateLeadScore(ownerEmail, userId); } catch (e) {
      console.error('Lead score update failed:', e?.message || e);
    }
  }

  breakIntoMessages(text, maxLen = 160) {
    const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [text];
    const out = [];
    let cur = '';
    for (const s of sentences) {
      const t = s.trim();
      if (!t || t.length <= 3) continue;
      if ((cur + ' ' + t).trim().length > maxLen && cur) { out.push(cur.trim()); cur = t; }
      else { cur += (cur ? ' ' : '') + t; }
    }
    if (cur.trim().length > 3) out.push(cur.trim());
    return out.length ? out : [text];
  }
}


class BaileysSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  sessionPath(ownerEmail) {
    const safe = ownerEmail.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(SESSIONS_DIR, safe);
  }

  get(ownerEmail) { return this.sessions.get(ownerEmail); }

  async init(ownerEmail) {
    const existing = this.sessions.get(ownerEmail);
    if (existing) {
      const ok = (existing.state === 'connected' && existing.sock)
        || (existing.state === 'qr_ready' && (existing.qrImage || existing.qr))
        || (existing.state === 'connecting' && (existing.initPromise || existing.sock));
      if (ok) return existing;
      // Stale session — restart cleanly
      if (existing.reconnectTimer) { clearTimeout(existing.reconnectTimer); existing.reconnectTimer = null; }
      existing.isShuttingDown = true;
      if (existing.sock) { try { existing.sock.end(new Error('stale_restart')); } catch (_) {} }
      this.sessions.delete(ownerEmail);
    }

    // FIX 1: Record session start timestamp — used to ignore old messages after re-login
    const sessionStartedAt = new Date();
    try {
      await SessionStart.findOneAndUpdate(
        { owner_email: ownerEmail },
        { $set: { session_started_at: sessionStartedAt, updated_at: new Date() } },
        { upsert: true }
      );
      console.log(`[WA] Session start recorded for ${ownerEmail}: ${sessionStartedAt.toISOString()}`);
    } catch (e) { console.error('[WA] sessionStart save error:', e?.message); }

    const session = {
      ownerEmail, state: 'connecting', qr: null, qrImage: null, phone: null,
      lastError: null, reconnectAttempts: 0, listeners: new Set(),
      sock: null, saveCreds: null, starting: true, initPromise: null,
      reconnectTimer: null, socketEpoch: 0, isShuttingDown: false,
      sessionStartedAt, // in-memory copy for fast access
    };
    this.sessions.set(ownerEmail, session);
    this.emit(session, { event: 'status', data: 'connecting' });

    session.initPromise = this.startSocket(session)
      .catch((e) => {
        session.lastError = e.message || 'socket_init_failed';
        session.state = 'error';
        this.emit(session, { event: 'status', data: 'error' });
      })
      .finally(() => { session.starting = false; session.initPromise = null; });

    // Wait for the socket to at least start before returning
    await session.initPromise;
    return session;
  }


  async startSocket(session) {
    if (session.reconnectTimer) { clearTimeout(session.reconnectTimer); session.reconnectTimer = null; }
    session.isShuttingDown = false;
    session.state = 'connecting';
    const authDir = this.sessionPath(session.ownerEmail);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version;
    try {
      const latest = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('version_timeout')), 8000)),
      ]);
      version = latest?.version;
    } catch (_) { version = undefined; }

    const logger = P({ level: 'fatal' });
    const socketConfig = {
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.windows('Chrome'),
      syncFullHistory: false,
      connectTimeoutMs: 45_000,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
      markOnlineOnConnect: true,
      logger,
    };
    if (version) socketConfig.version = version;

    const epoch = (session.socketEpoch || 0) + 1;
    session.socketEpoch = epoch;
    if (session.sock) { try { session.sock.end(new Error('replaced')); } catch (_) {} }

    const sock = makeWASocket(socketConfig);
    session.sock = sock;
    session.saveCreds = saveCreds;
    sock.ev.on('creds.update', saveCreds);

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      // Resolve once we get QR or connection (so init() can return)
      setTimeout(done, 30000); // safety timeout

      sock.ev.on('connection.update', async (update) => {
        if (epoch !== session.socketEpoch) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.state = 'qr_ready';
          session.qr = qr;
          try { session.qrImage = await QRCode.toDataURL(qr); } catch (_) { session.qrImage = ''; }
          console.log(`[WA] QR ready for owner=${session.ownerEmail}`);
          this.emit(session, { event: 'qr', data: session.qrImage });
          this.emit(session, { event: 'status', data: 'qr_ready' });
          done();
        }

        if (connection === 'open') {
          session.state = 'connected';
          session.reconnectAttempts = 0;
          const meId = sock.user?.id ? String(sock.user.id) : '';
          session.phone = meId.split(':')[0] || null;
          console.log(`[WA] Connected! owner=${session.ownerEmail} phone=${session.phone}`);
          this.emit(session, { event: 'status', data: 'connected' });
          done();
        }

        if (connection === 'close') {
          if (session.isShuttingDown) return done();
          const statusCode = (lastDisconnect?.error instanceof Boom)
            ? lastDisconnect.error.output.statusCode
            : lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          if (loggedOut) {
            session.state = 'disconnected';
            session.lastError = 'logged_out';
            this.emit(session, { event: 'status', data: 'disconnected' });
            session.socketEpoch += 1;
            await this.clearAuth(session.ownerEmail);
            done();
          } else {
            session.state = 'reconnecting';
            session.reconnectAttempts += 1;
            const delay = Math.min(30000, Math.pow(2, Math.min(session.reconnectAttempts, 6)) * 1000);
            this.emit(session, { event: 'status', data: 'reconnecting' });
            done(); // resolve so init() doesn't hang
            if (!session.reconnectTimer) {
              session.reconnectTimer = setTimeout(() => {
                session.reconnectTimer = null;
                if (this.sessions.get(session.ownerEmail) !== session || session.isShuttingDown) return;
                this.startSocket(session).catch((e) => {
                  session.lastError = e.message;
                  this.emit(session, { event: 'status', data: 'error' });
                });
              }, delay);
            }
          }
        }
      });

      // ── messages.upsert: THE single source of truth for incoming messages
      sock.ev.on('messages.upsert', async (m) => {
        if (epoch !== session.socketEpoch) return;
        const ownerEmail = session.ownerEmail;
        const incoming = Array.isArray(m.messages) ? m.messages : [];

        for (const msg of incoming) {
          try {
            if (!msg || msg.key?.fromMe) continue;

            const remoteJid = String(msg.key?.remoteJid || '');
            if (!this.isDirectInboundJid(remoteJid)) continue;

            const text = this.extractIncomingText(msg.message);
            if (!text) continue;

            // ── BUG 1 FIX: Skip messages received BEFORE session started ─────
            const msgTimestampSec = Number(msg.messageTimestamp || 0);
            const msgTime = msgTimestampSec > 0 ? new Date(msgTimestampSec * 1000) : new Date();
            const sessionStart = session.sessionStartedAt || new Date(0);
            if (msgTime < sessionStart) {
              console.log(`[WA] ⏭ Skipping pre-session message from ${remoteJid}`);
              continue;
            }

            // ── BUG 1 FIX: Canonical phone resolution (NEVER use @lid as ID) ──
            // Priority order for phone resolution:
            //   1. msg.key.senderPn  → Baileys provides this for @lid messages
            //   2. remoteJid if @s.whatsapp.net
            //   3. lidMap cache (built from contacts.update events)
            //   4. sock.signalRepository.lidMapping.getPNForLID() if available
            //   5. Last resort: skip the message (DON'T save under LID)
            let canonicalPhone = null;
            const senderPn = String(msg.key?.senderPn || '').replace(/[^\d]/g, '');

            if (senderPn) {
              // Best case: Baileys gave us the phone directly
              canonicalPhone = senderPn;
            } else if (remoteJid.endsWith('@s.whatsapp.net')) {
              canonicalPhone = remoteJid.split('@')[0];
            } else if (remoteJid.endsWith('@lid')) {
              const lid = remoteJid.split('@')[0];
              // Check our in-memory LID→phone cache (populated by contacts.update)
              if (session.lidMap && session.lidMap[lid]) {
                canonicalPhone = session.lidMap[lid];
                console.log(`[WA] LID ${lid} resolved from cache → ${canonicalPhone}`);
              } else {
                // Try Baileys' built-in lidMapping if available
                try {
                  const pn = await session.sock.signalRepository?.lidMapping?.getPNForLID?.(remoteJid);
                  if (pn) {
                    canonicalPhone = String(pn).split('@')[0].replace(/[^\d]/g, '');
                    if (canonicalPhone) {
                      session.lidMap = session.lidMap || {};
                      session.lidMap[lid] = canonicalPhone;
                      console.log(`[WA] LID ${lid} resolved via lidMapping → ${canonicalPhone}`);
                    }
                  }
                } catch (_) {}
              }

              if (!canonicalPhone) {
                // STILL UNRESOLVED — DO NOT save under LID, that creates orphan threads
                // Wait for contacts.update to fill the mapping. Skip this message for now
                // but emit a warning so we know.
                console.log(`[WA] ⚠ Cannot resolve LID ${lid} to phone — skipping message to avoid orphan thread`);
                continue;
              }
            } else {
              canonicalPhone = remoteJid.split('@')[0];
            }

            const pushName = String(msg.pushName || msg.notify || '').trim();
            const replyJid = remoteJid;

            console.log(`[WA] ✅ MSG from phone=${canonicalPhone} jid=${remoteJid} name="${pushName}" text="${text.substring(0, 60)}"`);

            this.handleIncomingText(ownerEmail, canonicalPhone, text, msg.key?.id || '', replyJid, pushName)
              .catch((err) => console.error(`[WA] handleIncomingText error:`, err?.message || err));
          } catch (err) {
            console.error('[WA] messages.upsert error:', err?.message || err);
          }
        }
      });

      // ── BUG 1 FIX: Build LID → phone map from contacts.update events ─────
      // WhatsApp sends contact updates with both @lid and @s.whatsapp.net IDs
      sock.ev.on('contacts.update', (updates) => {
        if (epoch !== session.socketEpoch) return;
        session.lidMap = session.lidMap || {};
        for (const c of updates) {
          const id = String(c?.id || '');
          // contact.id sometimes has the @lid, with .lid being the linked phone
          if (id.endsWith('@lid') && c?.notify) {
            // No direct phone in update — we'll rely on senderPn / signalRepository
          }
          // Some contact entries pair lid + phone
          if (c?.lid && c?.id?.endsWith?.('@s.whatsapp.net')) {
            const lidKey = String(c.lid).split('@')[0];
            const phone = c.id.split('@')[0];
            session.lidMap[lidKey] = phone;
            console.log(`[WA] LID map updated: ${lidKey} → ${phone}`);
          }
        }
      });

      // Same for contacts.upsert
      sock.ev.on('contacts.upsert', (contacts) => {
        if (epoch !== session.socketEpoch) return;
        session.lidMap = session.lidMap || {};
        for (const c of contacts) {
          if (c?.lid && c?.id?.endsWith?.('@s.whatsapp.net')) {
            const lidKey = String(c.lid).split('@')[0];
            const phone = c.id.split('@')[0];
            session.lidMap[lidKey] = phone;
            console.log(`[WA] LID map (upsert): ${lidKey} → ${phone}`);
          }
        }
      });
    });
  }


  unwrapMessageContent(message) {
    if (!message || typeof message !== 'object') return {};
    if (message.ephemeralMessage?.message) return this.unwrapMessageContent(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return this.unwrapMessageContent(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return this.unwrapMessageContent(message.viewOnceMessageV2.message);
    if (message.documentWithCaptionMessage?.message) return this.unwrapMessageContent(message.documentWithCaptionMessage.message);
    return message;
  }

  extractIncomingText(message) {
    const m = this.unwrapMessageContent(message);
    return String(
      m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption
      || m?.videoMessage?.caption || m?.documentMessage?.caption
      || m?.buttonsResponseMessage?.selectedDisplayText
      || m?.listResponseMessage?.title || ''
    ).trim();
  }

  isDirectInboundJid(jid) {
    const v = String(jid || '');
    if (!v || v.endsWith('@g.us') || v === 'status@broadcast'
      || v.endsWith('@broadcast') || v.endsWith('@newsletter')) return false;
    return v.endsWith('@s.whatsapp.net') || v.endsWith('@lid');
  }

  userIdFromJid(jid) { return String(jid || '').split('@')[0] || ''; }

  emit(session, payload) {
    for (const send of session.listeners) { try { send(payload); } catch (_) {} }
  }

  attachSse(ownerEmail, send) {
    const session = this.sessions.get(ownerEmail);
    if (!session) {
      // No session yet — send connecting status and add to a pending map
      send({ event: 'status', data: 'connecting' });
      return () => {};
    }
    session.listeners.add(send);
    // Replay current state immediately
    if (session.qrImage) {
      send({ event: 'qr', data: session.qrImage });
    }
    send({ event: 'status', data: session.state });
    return () => { session.listeners.delete(send); };
  }

  status(ownerEmail) {
    const s = this.sessions.get(ownerEmail);
    if (!s) return { connected: false, state: 'disconnected', phone: null };
    return { connected: s.state === 'connected', state: s.state, phone: s.phone,
      last_error: s.lastError, reconnect_attempts: s.reconnectAttempts };
  }

  // sendText: general purpose — to is used for both JID and userId
  async sendText(ownerEmail, to, message) {
    const session = await this.init(ownerEmail);
    if (!session.sock || session.state !== 'connected') throw new Error('WhatsApp not connected');
    const rawTo = String(to || '').trim();
    const jid = rawTo.includes('@') ? rawTo : `${rawTo.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const storedUserId = jid.split('@')[0].replace(/[^\d]/g, '') || jid.split('@')[0];
    const sent = await session.sock.sendMessage(jid, { text: message });
    try {
      await Conversation.create(ownerScope(ownerEmail,
        { userId: storedUserId, role: 'assistant', content: message, messageId: sent?.key?.id || '' }));
    } catch (e) { console.error('[WA] sendText save err:', e?.message); }
    return { messageId: sent?.key?.id || '' };
  }

  // sendTextToPhone: used for agent replies — phoneUserId (thread owner) separate from replyJid
  async sendTextToPhone(ownerEmail, phoneUserId, replyJid, message) {
    const session = await this.init(ownerEmail);
    if (!session.sock || session.state !== 'connected') throw new Error('WhatsApp not connected');
    // Determine the actual WA JID to send to
    const jid = replyJid.includes('@') ? replyJid : `${phoneUserId}@s.whatsapp.net`;
    console.log(`[WA] sendTextToPhone userId=${phoneUserId} jid=${jid}`);
    const sent = await session.sock.sendMessage(jid, { text: message });
    // Always save under phoneUserId (canonical phone) — NOT the @lid
    try {
      await Conversation.create(ownerScope(ownerEmail,
        { userId: phoneUserId, role: 'assistant', content: message, messageId: sent?.key?.id || '' }));
    } catch (e) { console.error('[WA] sendTextToPhone save err:', e?.message); }
    return { messageId: sent?.key?.id || '' };
  }

  async sendMedia(ownerEmail, to, payload) {
    const session = await this.init(ownerEmail);
    if (!session.sock || session.state !== 'connected') throw new Error('WhatsApp not connected');
    const digits = String(to || '').replace(/[^\d]/g, '');
    const jid = `${digits}@s.whatsapp.net`;
    const sent = await session.sock.sendMessage(jid, payload);
    return { messageId: sent?.key?.id || '' };
  }

  async handleIncomingText(ownerEmail, from, body, messageId, replyJid = '', pushName = '') {
    const inbound = String(body || '').trim();
    if (!inbound) return;

    const safeOwner = String(ownerEmail || DEFAULT_OWNER).trim().toLowerCase();
    const safeFrom = String(from || '').replace(/[^\d]/g, '') || String(from || '').trim();
    const safeMsgId = String(messageId || '').trim();
    const safeName = String(pushName || '').trim();

    if (!safeOwner || !safeFrom) { console.error('[WA] Missing owner or from'); return; }
    console.log(`[WA] STEP1: from=${safeFrom} name="${safeName}" owner=${safeOwner}`);

    // Dedupe by messageId
    if (safeMsgId) {
      try {
        const dup = await Conversation.findOne({ owner_email: safeOwner, messageId: safeMsgId, role: 'user' }).lean();
        if (dup) { console.log(`[WA] Dup skip msgId=${safeMsgId}`); return; }
      } catch (e) { console.error('[WA] dedupe err:', e?.message); }
    }

    // ── FIX 3: Upsert profile WITH pushName ────────────────────────────
    try {
      const setFields = { lastInteraction: new Date() };
      if (safeName) {
        setFields.pushName = safeName;
        setFields.name = safeName; // also save to legacy "name" field
      }
      await UserProfile.findOneAndUpdate(
        ownerScope(safeOwner, { userId: safeFrom }),
        { $setOnInsert: ownerScope(safeOwner, { userId: safeFrom, createdAt: new Date() }), $set: setFields },
        { upsert: true }
      );
    } catch (e) { console.error('[WA] profile upsert err:', e?.message); }

    // Save inbound message
    try {
      await Conversation.create(ownerScope(safeOwner, { userId: safeFrom, role: 'user', content: inbound, messageId: safeMsgId }));
    } catch (e) { console.error('[WA] save err:', e?.message); }

    // Closing keywords — end active conversation
    const closingPattern = /^(bye|goodbye|thanks|thank you|thank u|ty|no thanks|nahi|band karo|ruk|stop|chalo bye|ok bye)\b/i;
    if (closingPattern.test(inbound)) {
      try {
        await UserProfile.findOneAndUpdate(
          ownerScope(safeOwner, { userId: safeFrom }),
          { $set: { activeConversation: false, conversationClosed: true, lastReplyAt: new Date() } }
        );
        console.log(`[WA] Conversation closed by user phrase for ${safeFrom}`);
      } catch (_) {}
      // Send polite closing reply
      const target = replyJid || safeFrom;
      try { await this.sendTextToPhone(safeOwner, safeFrom, target, "Sure, thanks for your time! Reach out anytime."); } catch (_) {}
      return;
    }

    // Opt-out
    if (/^(unsubscribe|optout)$/i.test(inbound)) {
      try {
        await UserProfile.findOneAndUpdate(
          ownerScope(safeOwner, { userId: safeFrom }),
          { $set: { marketingOptOut: true, activeConversation: false } }
        );
        await this.sendText(safeOwner, replyJid || safeFrom, 'You have been unsubscribed.');
      } catch (e) { console.error('[WA] optout err:', e?.message); }
      return;
    }

    // Read profile
    let profile = null;
    try { profile = await UserProfile.findOne(ownerScope(safeOwner, { userId: safeFrom })).lean(); } catch (_) {}
    if (profile?.marketingOptOut) return;

    // ── FIX 2: ACTIVE CONVERSATION LOGIC ──────────────────────────────
    // If contact is in active conversation, ALWAYS reply (skip keyword check).
    // Otherwise, check keyword scope. Once keyword matches, mark as active.

    const ACTIVE_TIMEOUT_HOURS = 24;
    const activeTimeoutMs = ACTIVE_TIMEOUT_HOURS * 60 * 60 * 1000;
    const now = Date.now();

    // Check if existing active conversation has timed out
    let isActive = !!profile?.activeConversation;
    const lastReply = profile?.lastReplyAt ? new Date(profile.lastReplyAt).getTime() : 0;
    if (isActive && lastReply > 0 && (now - lastReply) > activeTimeoutMs) {
      console.log(`[WA] Active conversation timed out for ${safeFrom} (>${ACTIVE_TIMEOUT_HOURS}h)`);
      isActive = false;
      try {
        await UserProfile.findOneAndUpdate(
          ownerScope(safeOwner, { userId: safeFrom }),
          { $set: { activeConversation: false } }
        );
      } catch (_) {}
    }

    // If conversation was explicitly closed, only re-activate on keyword match
    if (profile?.conversationClosed) {
      isActive = false;
    }

    let cfg = null;
    try { cfg = await mongoose.connection.collection('agent_configs').findOne({ owner_email: safeOwner }); } catch (_) {}

    let shouldReply = false;
    if (isActive) {
      // Already in active convo — always reply, no keyword check
      shouldReply = true;
      console.log(`[WA] In active conversation — replying without keyword check`);
    } else if (cfg?.reply_scope === 'keywords') {
      const kws = Array.isArray(cfg.reply_keywords) ? cfg.reply_keywords : [];
      const matched = kws.some((k) => k && inbound.toLowerCase().includes(k));
      if (matched) {
        shouldReply = true;
        console.log(`[WA] Keyword matched — starting active conversation`);
        // Mark conversation as active for follow-up messages
        try {
          await UserProfile.findOneAndUpdate(
            ownerScope(safeOwner, { userId: safeFrom }),
            { $set: { activeConversation: true, activeSince: new Date(), conversationClosed: false } }
          );
        } catch (_) {}
      } else {
        console.log(`[WA] No keyword match — skipping reply`);
        return;
      }
    } else {
      // Default: reply to all
      shouldReply = true;
      // Also mark as active so logic stays consistent
      try {
        await UserProfile.findOneAndUpdate(
          ownerScope(safeOwner, { userId: safeFrom }),
          { $set: { activeConversation: true, activeSince: profile?.activeSince || new Date(), conversationClosed: false } }
        );
      } catch (_) {}
    }

    if (!shouldReply) return;

    // Human-like typing delay 4-5s
    await new Promise((r) => setTimeout(r, 4000 + Math.floor(Math.random() * 1000)));

    let reply = '';
    try {
      reply = await agent.chat(safeOwner, safeFrom, inbound);
      console.log(`[WA] AI reply: "${reply.substring(0, 80)}"`);
    } catch (e) { console.error('[WA] AI err:', e?.message); return; }

    if (!reply?.trim()) return;

    const parts = agent.breakIntoMessages(reply);
    const target = replyJid || safeFrom;
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      try { await this.sendTextToPhone(safeOwner, safeFrom, target, parts[i]); } catch (e) { console.error(`[WA] send err part ${i}:`, e?.message); }
    }

    // Update lastReplyAt for active-conversation timeout tracking
    try {
      await UserProfile.findOneAndUpdate(
        ownerScope(safeOwner, { userId: safeFrom }),
        { $set: { lastReplyAt: new Date() } }
      );
    } catch (_) {}

    try { await agent.refreshLeadScore(safeOwner, safeFrom); } catch (_) {}
    console.log(`[WA] ✅ DONE replied to ${safeFrom} parts=${parts.length}`);
  }

  async logout(ownerEmail) {
    const session = this.sessions.get(ownerEmail);
    if (session?.sock) {
      session.isShuttingDown = true;
      if (session.reconnectTimer) { clearTimeout(session.reconnectTimer); session.reconnectTimer = null; }
      try { await session.sock.logout(); } catch (_) {}
      try { session.sock.end(new Error('logout')); } catch (_) {}
    }
    this.sessions.delete(ownerEmail);
    await this.clearAuth(ownerEmail);
    return { success: true };
  }

  async clearAuth(ownerEmail) {
    const authDir = this.sessionPath(ownerEmail);
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  }
}

const agent = new SalesAgent();
const waManager = new BaileysSessionManager();

function ownerFromReq(req) {
  return (req.headers[OWNER_HEADER] || req.query.owner || req.body?.owner || DEFAULT_OWNER)
    .toString().trim().toLowerCase();
}


async function startServer() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try { await mongoose.connection.collection('userprofiles').dropIndex('userId_1'); } catch (_) {}
  console.log('MongoDB connected');

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Owner-Email');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_NAME, ts: new Date() }));

  // ─────────────────────────────────────────────────────
  // PER-USER AGENT CONFIG (custom name + description + scope)
  // Stored in MongoDB collection: agent_configs
  // Fields: owner_email, agent_name, agent_description,
  //         reply_scope ("all" | "keywords"), reply_keywords (array)
  // ─────────────────────────────────────────────────────
  app.get('/api/agent-config', async (req, res) => {
    const owner = ownerFromReq(req);
    const cfg = await mongoose.connection.collection('agent_configs')
      .findOne({ owner_email: owner }) || {};
    return res.json({
      owner_email: owner,
      agent_name: cfg.agent_name || '',
      agent_description: cfg.agent_description || '',
      reply_scope: cfg.reply_scope || 'all',
      reply_keywords: cfg.reply_keywords || [],
      configured: Boolean(cfg.agent_description && cfg.agent_description.trim()),
    });
  });

  app.post('/api/agent-config', async (req, res) => {
    const owner = ownerFromReq(req);
    const { agent_name, agent_description, reply_scope, reply_keywords } = req.body || {};
    if (!agent_name || !agent_description || !String(agent_description).trim()) {
      return res.status(400).json({ error: 'agent_name and agent_description are required' });
    }
    const scope = (reply_scope === 'keywords') ? 'keywords' : 'all';
    const keywords = Array.isArray(reply_keywords)
      ? reply_keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      : [];
    await mongoose.connection.collection('agent_configs').updateOne(
      { owner_email: owner },
      {
        $set: {
          owner_email: owner,
          agent_name: String(agent_name).trim(),
          agent_description: String(agent_description).trim(),
          reply_scope: scope,
          reply_keywords: keywords,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    console.log(`[WA] Agent config saved for owner=${owner}, scope=${scope}`);
    return res.json({ success: true, owner_email: owner, configured: true });
  });

  // ── FIX: /api/whatsapp/force-logout — clears stale session + auth files
  app.post('/api/whatsapp/force-logout', async (req, res) => {
    const owner = ownerFromReq(req);
    await waManager.logout(owner);
    console.log(`[WA] Force logout done for owner=${owner}`);
    return res.json({ success: true, message: 'Session cleared. Generate QR again.' });
  });

  app.post('/api/whatsapp/init-connection', async (req, res) => {
    const owner = ownerFromReq(req);
    try {
      // FIX: If there's an existing stale session, clear it first so QR regenerates
      const existing = waManager.get(owner);
      if (existing && existing.state !== 'connected' && existing.state !== 'qr_ready') {
        await waManager.logout(owner);
        console.log(`[WA] Cleared stale session for owner=${owner}, state was: ${existing?.state}`);
      }
      await waManager.init(owner);
      return res.json({ status: 'initializing', stream_url: '/api/whatsapp/qr-stream', owner });
    } catch (e) {
      console.error(`[WA init] owner=${owner} failed:`, e?.message);
      return res.status(500).json({ error: e?.message || 'whatsapp_init_failed' });
    }
  });

  app.get('/api/whatsapp/health', async (req, res) => {
    const owner = ownerFromReq(req);
    return res.json({ ok: true, agent: AGENT_NAME, owner, status: waManager.status(owner), ts: new Date() });
  });

  // ── FIX: QR stream — init first, THEN attach SSE listener
  app.get('/api/whatsapp/qr-stream', async (req, res) => {
    const owner = ownerFromReq(req);
    console.log(`[WA] SSE stream opened for owner=${owner}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (payload) => {
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
    };

    let detach = () => {};
    let closed = false;

    req.on('close', () => {
      closed = true;
      detach();
      try { res.end(); } catch (_) {}
    });

    try {
      // init() now awaits QR/connection before resolving
      await waManager.init(owner);
      if (!closed) {
        detach = waManager.attachSse(owner, send);
      }
    } catch (e) {
      send({ event: 'status', data: 'error', error: e?.message });
    }
  });

  app.get('/api/whatsapp/status', async (req, res) => {
    const owner = ownerFromReq(req);
    return res.json(waManager.status(owner));
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    const owner = ownerFromReq(req);
    return res.json(await waManager.logout(owner));
  });


  app.get('/api/leads', async (req, res) => {
    const owner = ownerFromReq(req);
    const min = parseInt(req.query.minScore, 10) || 0;
    const leads = await UserProfile.find(ownerScope(owner, { leadScore: { $gte: min } }))
      .sort({ leadScore: -1 }).limit(200).lean();
    return res.json(leads);
  });

  app.delete('/api/leads/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    await UserProfile.deleteOne(ownerScope(owner, { userId: req.params.userId }));
    await Conversation.deleteMany(ownerScope(owner, { userId: req.params.userId }));
    return res.json({ success: true });
  });

  app.get('/api/conversations/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    const msgs = await Conversation.find(ownerScope(owner, { userId: req.params.userId }))
      .sort({ timestamp: 1 }).limit(300).lean();
    return res.json(msgs);
  });

  app.get('/api/stats', async (req, res) => {
    const owner = ownerFromReq(req);
    const [totalUsers, hotLeads, totalMessages] = await Promise.all([
      UserProfile.countDocuments(ownerScope(owner)),
      UserProfile.countDocuments(ownerScope(owner, { leadScore: { $gte: 70 } })),
      Conversation.countDocuments(ownerScope(owner)),
    ]);
    return res.json({ agent: AGENT_NAME, totalUsers, hotLeads, totalMessages });
  });

  app.post('/api/outbound', async (req, res) => {
    const owner = ownerFromReq(req);
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    try {
      const sent = await waManager.sendText(owner, to, message);
      return res.json({ success: true, to: String(to).replace(/[^\d]/g, ''), message, message_id: sent.messageId });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  });

  app.post('/api/outbound/template', async (req, res) => {
    const owner = ownerFromReq(req);
    const { to, template, variables = [] } = req.body;
    if (!to || !template) return res.status(400).json({ error: 'to and template required' });

    // Use per-user agent config first
    const cfg = await mongoose.connection.collection('agent_configs')
      .findOne({ owner_email: owner }).catch(() => null);
    const account = await mongoose.connection.collection('users')
      .findOne({ email: owner }, { projection: { agent_name: 1, business_name: 1 } }).catch(() => null);

    const agentName = (cfg?.agent_name || account?.agent_name || 'Assistant').trim();
    const businessName = (account?.business_name || '').trim();

    // Generate intro using user's custom description if available — otherwise generic
    let text;
    if (cfg?.agent_description && cfg.agent_description.trim()) {
      const greet = variables[0] ? `Hi ${variables[0]}!` : 'Hi!';
      text = `${greet} ${agentName} here. ${cfg.agent_description.trim().split('.')[0]}. Can we have a quick chat?`;
    } else if (businessName) {
      text = `Hi${variables[0] ? ' ' + variables[0] : ''}! This is ${agentName} from ${businessName}.`;
    } else {
      text = `Hi${variables[0] ? ' ' + variables[0] : ''}! This is ${agentName}. Can we have a quick chat?`;
    }

    // Dedupe: don't send the same template text to the same number within 60s
    const phoneDigits = String(to).replace(/[^\d]/g, '');
    const recent = await Conversation.findOne({
      owner_email: owner,
      userId: { $in: [phoneDigits, '+' + phoneDigits] },
      role: 'assistant',
      content: text,
      timestamp: { $gte: new Date(Date.now() - 60_000) },
    }).lean().catch(() => null);
    if (recent) {
      console.log(`[WA] Skipping duplicate template send to ${phoneDigits} (sent within 60s)`);
      return res.json({ success: true, deduped: true, message_id: '' });
    }

    try {
      const sent = await waManager.sendText(owner, to, text);
      return res.json({ success: true, to: phoneDigits, template, message_id: sent.messageId });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  });

  app.post('/api/whatsapp/send-message', async (req, res) => {
    const owner = ownerFromReq(req);
    const { to, message, mediaUrl, mimeType, filename } = req.body;
    if (!to) return res.status(400).json({ error: 'to required' });
    try {
      if (mediaUrl) {
        const payload = {};
        if ((mimeType || '').startsWith('image/')) payload.image = { url: mediaUrl };
        else if ((mimeType || '').startsWith('audio/')) payload.audio = { url: mediaUrl };
        else payload.document = { url: mediaUrl };
        if (message) payload.caption = message;
        if (filename) payload.fileName = filename;
        return res.json({ success: true, message_id: (await waManager.sendMedia(owner, to, payload)).messageId });
      }
      if (!message) return res.status(400).json({ error: 'message required' });
      return res.json({ success: true, message_id: (await waManager.sendText(owner, to, message)).messageId });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  });

  app.post('/api/campaign', async (req, res) => {
    const owner = ownerFromReq(req);
    const { message, minScore = 0, maxScore = 100 } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const leads = await UserProfile.find(ownerScope(owner, {
      marketingOptOut: { $ne: true }, leadScore: { $gte: minScore, $lte: maxScore },
    })).lean();
    res.json({ success: true, total: leads.length, status: 'Campaign started' });
    (async () => {
      let sent = 0, failed = 0;
      for (const lead of leads) {
        try {
          await waManager.sendText(owner, lead.userId, message.replace('{name}', lead.name || 'there'));
          sent++;
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) { failed++; console.error(`Campaign failed for ${lead.userId}:`, e.message); }
      }
      console.log(`Campaign done — sent: ${sent}, failed: ${failed}`);
    })();
  });

  app.put('/api/leads/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    const updated = await UserProfile.findOneAndUpdate(
      ownerScope(owner, { userId: req.params.userId }), { $set: req.body }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    return res.json(updated);
  });

  cron.schedule('0 9 * * *', async () => {
    const count = await UserProfile.countDocuments(ownerScope(DEFAULT_OWNER, { leadScore: { $gte: 70 } }));
    console.log(`[${AGENT_NAME}] Hot leads: ${count}`);
  });

  app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = parseInt(process.env.PORT, 10) || 3000;
  app.listen(PORT, async () => {
    console.log(`\n${AGENT_NAME} LIVE on port ${PORT}`);
    console.log(`  QR SSE : GET  http://localhost:${PORT}/api/whatsapp/qr-stream`);
    console.log(`  Status : GET  http://localhost:${PORT}/api/whatsapp/status`);
    console.log(`  Health : GET  http://localhost:${PORT}/health\n`);

    // ── BUG 2 FIX: Auto-restore all existing WhatsApp sessions on server start ──
    // Scan sessions/ folder — every subdirectory is an owner whose Baileys creds
    // are stored on disk. Init each so the messages.upsert listener is registered
    // immediately. No outbound message needed to "wake up" the agent.
    try {
      const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      const owners = dirs
        .map((name) => name.replace(/_/g, '@').replace(/@(?=[^@]*$)/, '.').toLowerCase())
        // Folder format: user_gmail.com → undo to user@gmail.com
        // The replace above is brittle, so let's also accept anything with @ already
        .filter(Boolean);

      // Better: match each folder back to a known owner via DB lookup
      const knownOwners = await mongoose.connection.collection('agent_configs')
        .find({}, { projection: { owner_email: 1 } }).toArray();
      const ownerEmails = new Set(knownOwners.map((c) => c.owner_email).filter(Boolean));

      // Also pick up any owners from session folder names — convert back from "_" format
      for (const dir of dirs) {
        // sessionPath replaces non-alphanumeric/_-. with _. Best-effort reverse:
        // folder "samerkarwande3_gmail.com" → "samerkarwande3@gmail.com"
        const candidate = dir.replace(/_(?=[a-z0-9-]+\.[a-z]{2,}$)/, '@');
        if (candidate.includes('@') && candidate.includes('.')) {
          ownerEmails.add(candidate);
        }
      }

      console.log(`[WA] Auto-restoring ${ownerEmails.size} session(s):`, [...ownerEmails]);
      for (const owner of ownerEmails) {
        try {
          await waManager.init(owner);
          console.log(`[WA] ✅ Restored session for ${owner}`);
        } catch (e) {
          console.error(`[WA] Failed to restore ${owner}:`, e?.message);
        }
      }
    } catch (e) {
      console.error('[WA] Auto-restore failed:', e?.message);
    }
  });
}

process.on('SIGINT', async () => { await mongoose.disconnect(); process.exit(0); });

startServer().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
