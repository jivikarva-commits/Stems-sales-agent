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
    console.error(` Missing env var: ${k}`);
    process.exit(1);
  }
});

const AGENT_NAME = 'Stems Sales Agent';
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const DEFAULT_OWNER = (process.env.PRIMARY_OWNER_EMAIL || 'samerkarwande3@gmail.com').trim().toLowerCase();
const OWNER_HEADER = 'x-owner-email';

function ownerScope(ownerEmail, extra = {}) {
  const owner = (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase();
  return { ...extra, owner_email: owner, user_id: owner };
}

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
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
  budget: String,
  location: String,
  purpose: String,
  leadScore: { type: Number, default: 0 },
  status: { type: String, enum: ['new', 'qualified', 'hot', 'cold', 'converted'], default: 'new' },
  marketingOptOut: { type: Boolean, default: false },
  tags: [String],
  owner_email: { type: String, index: true, default: DEFAULT_OWNER },
  user_id: { type: String, index: true, default() { return this.owner_email || DEFAULT_OWNER; } },
  lastInteraction: Date,
  createdAt: { type: Date, default: Date.now },
});
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

    const [history, profile, account] = await Promise.all([
      Conversation.find(scope).sort({ timestamp: -1 }).limit(20).lean().then((m) => m.reverse()),
      UserProfile.findOne(scope).lean().catch(() => ({})),
      mongoose.connection.collection('users')
        .findOne({ email: (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase() }, { projection: { agent_name: 1, business_name: 1, business_description: 1 } })
        .catch(() => null),
    ]);

    const response = await this.claude.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.7,
      system: this._buildPrompt(profile || {}, account || {}),
      messages: [
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage },
      ],
    });

    return response.content[0].text;
  }

  _buildPrompt(profile, account) {
    const agentName = (account?.agent_name || 'AI Assistant').trim();
    const businessName = (account?.business_name || 'the business').trim();
    const businessDescription = (account?.business_description || '').trim();
    return `You are ${agentName}, AI assistant for ${businessName}.
${businessDescription}
Keep messages concise, natural, and human.
Never say you are AI or bot.
Language should match user (Hindi/Hinglish/English).
Ask one question at a time and guide to booking a strategy call.

CURRENT USER INFO:
- Budget: ${profile.budget || 'not captured yet'}
- Location: ${profile.location || 'not captured yet'}
- Purpose: ${profile.purpose || 'not captured yet'}`;
  }

  async _extractAndUpdateProfile(ownerEmail, userId, message) {
    const updates = {};
    const budgetMatch = message.match(/(\d[\d.]*)\s*(lakh|lakhs|lac|cr|crore|L|C)\b/i);
    if (budgetMatch) updates.budget = budgetMatch[0];
    const cities = ['mumbai', 'delhi', 'bangalore', 'bengaluru', 'gurgaon', 'gurugram', 'noida', 'pune', 'hyderabad', 'chennai', 'kolkata'];
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
    const recent = await Conversation.find(ownerScope(ownerEmail, { userId, role: 'user' })).sort({ timestamp: -1 }).limit(5).lean();
    if (recent.some((m) => /visit|demo|call|schedule|book/i.test(m.content))) score += 25;
    await UserProfile.findOneAndUpdate(ownerScope(ownerEmail, { userId }), { $set: { leadScore: Math.min(score, 100) } });
  }

  async refreshLeadScore(ownerEmail, userId) {
    try {
      await this._updateLeadScore(ownerEmail, userId);
    } catch (e) {
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
      if ((cur + ' ' + t).trim().length > maxLen && cur) {
        out.push(cur.trim());
        cur = t;
      } else {
        cur += (cur ? ' ' : '') + t;
      }
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

  get(ownerEmail) {
    return this.sessions.get(ownerEmail);
  }

  async init(ownerEmail) {
    const existing = this.sessions.get(ownerEmail);
    if (existing) {
      const healthyConnected = existing.state === 'connected' && existing.sock;
      const healthyQrReady = existing.state === 'qr_ready' && (existing.qrImage || existing.qr);
      const healthyStarting = existing.state === 'connecting' && (existing.initPromise || existing.sock);
      if (healthyConnected || healthyQrReady || healthyStarting) {
        return existing;
      }
      // Stale/broken in-memory session: restart cleanly so QR can regenerate.
      if (existing.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      existing.isShuttingDown = true;
      if (existing.sock) {
        try { existing.sock.end(new Error('stale_session_restart')); } catch (_) {}
      }
      this.sessions.delete(ownerEmail);
    }

    const session = {
      ownerEmail,
      state: 'connecting',
      qr: null,
      qrImage: null,
      phone: null,
      lastError: null,
      reconnectAttempts: 0,
      listeners: new Set(),
      sock: null,
      saveCreds: null,
      starting: true,
      initPromise: null,
      reconnectTimer: null,
      socketEpoch: 0,
      isShuttingDown: false,
    };
    this.sessions.set(ownerEmail, session);
    this.emit(session, { event: 'status', data: 'connecting' });
    session.initPromise = this.startSocket(session).catch((e) => {
      session.lastError = e.message || 'socket_init_failed';
      session.state = 'error';
      this.emit(session, { event: 'status', data: 'error' });
    }).finally(() => {
      session.starting = false;
      session.initPromise = null;
    });
    return session;
  }

  async startSocket(session) {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    session.isShuttingDown = false;
    session.state = 'connecting';
    const authDir = this.sessionPath(session.ownerEmail);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version;
    try {
      const latest = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('baileys_version_timeout')), 8000)),
      ]);
      version = latest?.version;
    } catch (_) {
      version = undefined;
    }
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
    if (session.sock) {
      try { session.sock.end(new Error('socket_replaced')); } catch (_) {}
    }
    const sock = makeWASocket(socketConfig);

    session.sock = sock;
    session.saveCreds = saveCreds;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (epoch !== session.socketEpoch) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        session.state = 'qr_ready';
        session.qr = qr;
        session.qrImage = await QRCode.toDataURL(qr);
        this.emit(session, { event: 'qr', data: session.qrImage });
        this.emit(session, { event: 'status', data: 'qr_ready' });
      }
      if (connection === 'open') {
        session.state = 'connected';
        session.reconnectAttempts = 0;
        const meId = (sock.user && sock.user.id) ? String(sock.user.id) : '';
        session.phone = meId.split(':')[0] || null;
        this.emit(session, { event: 'status', data: 'connected' });
      } else if (connection === 'close') {
        if (session.isShuttingDown) return;
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
        } else {
          session.state = 'reconnecting';
          session.reconnectAttempts += 1;
          const delayMs = Math.min(30000, Math.pow(2, Math.min(session.reconnectAttempts, 6)) * 1000);
          this.emit(session, { event: 'status', data: 'reconnecting' });
          if (session.reconnectTimer) return;
          session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            if (this.sessions.get(session.ownerEmail) !== session || session.isShuttingDown) return;
            this.startSocket(session).catch((e) => {
              session.lastError = e.message;
              this.emit(session, { event: 'status', data: 'error' });
            });
          }, delayMs);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (epoch !== session.socketEpoch) return;
      const incoming = Array.isArray(m.messages) ? m.messages : [];
      for (const msg of incoming) {
        try {
          if (!msg || msg.key?.fromMe) continue;
          const remoteJid = msg.key?.remoteJid || '';
          if (!this.isDirectInboundJid(remoteJid)) continue;
          const senderJid = msg.key?.participant || remoteJid;
          const userId = this.userIdFromJid(senderJid);
          const text = this.extractIncomingText(msg.message);
          if (!text) continue;
          await this.handleIncomingText(session.ownerEmail, userId, text, msg.key?.id || '', senderJid);
        } catch (err) {
          console.error('Incoming WhatsApp handling failed:', err?.message || err);
        }
      }
    });
  }

  unwrapMessageContent(message) {
    if (!message || typeof message !== 'object') return {};
    if (message.ephemeralMessage?.message) return this.unwrapMessageContent(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return this.unwrapMessageContent(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return this.unwrapMessageContent(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return this.unwrapMessageContent(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return this.unwrapMessageContent(message.documentWithCaptionMessage.message);
    return message;
  }

  extractIncomingText(message) {
    const m = this.unwrapMessageContent(message);
    let text = m?.conversation
      || m?.extendedTextMessage?.text
      || m?.imageMessage?.caption
      || m?.videoMessage?.caption
      || m?.documentMessage?.caption
      || m?.buttonsResponseMessage?.selectedDisplayText
      || m?.buttonsResponseMessage?.selectedButtonId
      || m?.listResponseMessage?.title
      || m?.listResponseMessage?.singleSelectReply?.selectedRowId
      || m?.templateButtonReplyMessage?.selectedDisplayText
      || m?.templateButtonReplyMessage?.selectedId
      || m?.interactiveResponseMessage?.body?.text
      || '';
    if (!text && m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const parsed = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
        text = parsed?.id || parsed?.title || parsed?.text || '';
      } catch (_) {
        text = m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson;
      }
    }
    return String(text || '').trim();
  }

  isDirectInboundJid(jid) {
    const v = String(jid || '');
    if (!v) return false;
    if (v.endsWith('@g.us')) return false;
    if (v === 'status@broadcast') return false;
    if (v.endsWith('@broadcast')) return false;
    if (v.endsWith('@newsletter')) return false;
    return v.endsWith('@s.whatsapp.net') || v.endsWith('@lid');
  }

  userIdFromJid(jid) {
    return String(jid || '').split('@')[0] || '';
  }

  emit(session, payload) {
    for (const send of session.listeners) {
      try {
        send(payload);
      } catch (_) {}
    }
  }

  async sendText(ownerEmail, to, message) {
    const session = await this.init(ownerEmail);
    if (!session.sock || session.state !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    const rawTo = String(to || '').trim();
    const jid = rawTo.includes('@')
      ? rawTo
      : (() => {
          const digits = rawTo.replace(/[^\d]/g, '');
          if (!digits) throw new Error('Invalid number');
          return `${digits}@s.whatsapp.net`;
        })();
    const storedUserId = this.userIdFromJid(jid);
    const sent = await session.sock.sendMessage(jid, { text: message });
    await Conversation.create(ownerScope(ownerEmail, { userId: storedUserId, role: 'assistant', content: message, messageId: sent?.key?.id || '' }));
    return { messageId: sent?.key?.id || '' };
  }

  async sendMedia(ownerEmail, to, payload) {
    const session = await this.init(ownerEmail);
    if (!session.sock || session.state !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    const digits = String(to || '').replace(/[^\d]/g, '');
    const jid = `${digits}@s.whatsapp.net`;
    const sent = await session.sock.sendMessage(jid, payload);
    return { messageId: sent?.key?.id || '' };
  }

  async handleIncomingText(ownerEmail, from, body, messageId, replyJid = '') {
    const inbound = String(body || '').trim();
    if (!inbound) return;
    await UserProfile.findOneAndUpdate(
      ownerScope(ownerEmail, { userId: from }),
      { $setOnInsert: ownerScope(ownerEmail, { userId: from, createdAt: new Date() }), $set: { lastInteraction: new Date() } },
      { upsert: true }
    );
    await Conversation.create(ownerScope(ownerEmail, { userId: from, role: 'user', content: inbound, messageId }));

    if (/^(stop|unsubscribe|optout)$/i.test(inbound)) {
      await UserProfile.findOneAndUpdate(ownerScope(ownerEmail, { userId: from }), { $set: { marketingOptOut: true } }, { upsert: true });
      await this.sendText(ownerEmail, from, 'You have been unsubscribed. You can still message us anytime for support.');
      return;
    }

    const profile = await UserProfile.findOne(ownerScope(ownerEmail, { userId: from })).lean();
    if (profile?.marketingOptOut) return;

    const reply = await agent.chat(ownerEmail, from, inbound);
    const parts = agent.breakIntoMessages(reply);
    const sendTarget = String(replyJid || '').includes('@') ? replyJid : from;
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1200));
      await this.sendText(ownerEmail, sendTarget, parts[i]);
    }
    await agent.refreshLeadScore(ownerEmail, from);
  }

  async logout(ownerEmail) {
    const session = this.sessions.get(ownerEmail);
    if (session?.sock) {
      session.isShuttingDown = true;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      try { await session.sock.logout(); } catch (_) {}
      try { session.sock.end(new Error('logout')); } catch (_) {}
    }
    this.sessions.delete(ownerEmail);
    await this.clearAuth(ownerEmail);
    return { success: true };
  }

  async clearAuth(ownerEmail) {
    const authDir = this.sessionPath(ownerEmail);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  }

  attachSse(ownerEmail, send) {
    const session = this.sessions.get(ownerEmail);
    if (!session) {
      send({ event: 'status', data: 'disconnected' });
      return () => {};
    }
    session.listeners.add(send);
    if (session.qrImage) send({ event: 'qr', data: session.qrImage });
    send({ event: 'status', data: session.state });
    return () => {
      session.listeners.delete(send);
    };
  }

  status(ownerEmail) {
    const s = this.sessions.get(ownerEmail);
    if (!s) return { connected: false, state: 'disconnected', phone: null };
    return {
      connected: s.state === 'connected',
      state: s.state,
      phone: s.phone,
      last_error: s.lastError,
      reconnect_attempts: s.reconnectAttempts,
    };
  }
}

const agent = new SalesAgent();
const waManager = new BaileysSessionManager();

function ownerFromReq(req) {
  return (req.headers[OWNER_HEADER] || req.query.owner || req.body?.owner || DEFAULT_OWNER).toString().trim().toLowerCase();
}

async function startServer() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await mongoose.connection.collection('userprofiles').dropIndex('userId_1');
  } catch (_e) {}
  console.log(' MongoDB connected');

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

  app.post('/api/whatsapp/init-connection', async (req, res) => {
    const owner = ownerFromReq(req);
    await waManager.init(owner);
    return res.json({ status: 'initializing', stream_url: '/api/whatsapp/qr-stream' });
  });

  app.get('/api/whatsapp/qr-stream', async (req, res) => {
    const owner = ownerFromReq(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    waManager.init(owner).catch(() => {});
    const detach = waManager.attachSse(owner, send);
    req.on('close', () => {
      detach();
      res.end();
    });
  });

  app.get('/api/whatsapp/status', async (req, res) => {
    const owner = ownerFromReq(req);
    return res.json(waManager.status(owner));
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    const owner = ownerFromReq(req);
    const out = await waManager.logout(owner);
    return res.json(out);
  });

  app.get('/api/leads', async (req, res) => {
    const owner = ownerFromReq(req);
    const min = parseInt(req.query.minScore, 10) || 0;
    const leads = await UserProfile.find(ownerScope(owner, { leadScore: { $gte: min } })).sort({ leadScore: -1 }).limit(200).lean();
    return res.json(leads);
  });

  app.get('/api/conversations/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    const msgs = await Conversation.find(ownerScope(owner, { userId: req.params.userId })).sort({ timestamp: 1 }).limit(300).lean();
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
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/outbound/template', async (req, res) => {
    const owner = ownerFromReq(req);
    const { to, template, variables = [] } = req.body;
    if (!to || !template) return res.status(400).json({ error: 'to and template required' });
    const account = await mongoose.connection.collection('users')
      .findOne({ email: owner }, { projection: { agent_name: 1, business_name: 1 } })
      .catch(() => null);
    const agentName = (account?.agent_name || 'our assistant').trim();
    const businessName = (account?.business_name || 'our team').trim();
    const text = template === 'stems_personalized_intro'
      ? `Hi ${variables[0] || 'there'}!  This is ${agentName} from ${businessName}. Hum aapke business ke liye qualified leads aur automated follow-ups setup kar sakte hain. Kya aap 10 min quick call ke liye available ho?`
      : `Hi!  This is ${agentName} from ${businessName}. Hum aapke business ke liye AI-powered lead generation + WhatsApp/email/call automation setup karte hain. Kya quick discussion kar sakte hain?`;
    try {
      const sent = await waManager.sendText(owner, to, text);
      return res.json({ success: true, to: String(to).replace(/[^\d]/g, ''), template, message_id: sent.messageId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
        const sent = await waManager.sendMedia(owner, to, payload);
        return res.json({ success: true, message_id: sent.messageId });
      }
      if (!message) return res.status(400).json({ error: 'message required for text send' });
      const sent = await waManager.sendText(owner, to, message);
      return res.json({ success: true, message_id: sent.messageId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/campaign', async (req, res) => {
    const owner = ownerFromReq(req);
    const { message, minScore = 0, maxScore = 100 } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const leads = await UserProfile.find(ownerScope(owner, {
      marketingOptOut: { $ne: true },
      leadScore: { $gte: minScore, $lte: maxScore },
    })).lean();
    res.json({ success: true, total: leads.length, status: 'Campaign started in background' });

    (async () => {
      let sent = 0;
      let failed = 0;
      for (const lead of leads) {
        try {
          const personalised = message.replace('{name}', lead.name || 'there');
          await waManager.sendText(owner, lead.userId, personalised);
          sent += 1;
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {
          failed += 1;
          console.error(`Campaign failed for ${lead.userId}:`, e.message);
        }
      }
      console.log(` Campaign done  sent: ${sent}, failed: ${failed}`);
    })();
  });

  app.put('/api/leads/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    const updated = await UserProfile.findOneAndUpdate(ownerScope(owner, { userId: req.params.userId }), { $set: req.body }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    return res.json(updated);
  });

  app.delete('/api/leads/:userId', async (req, res) => {
    const owner = ownerFromReq(req);
    await UserProfile.deleteOne(ownerScope(owner, { userId: req.params.userId }));
    await Conversation.deleteMany(ownerScope(owner, { userId: req.params.userId }));
    return res.json({ success: true });
  });

  cron.schedule('0 9 * * *', async () => {
    const count = await UserProfile.countDocuments(ownerScope(DEFAULT_OWNER, { leadScore: { $gte: 70 } }));
    console.log(` [${AGENT_NAME}] Hot leads: ${count}`);
  });

  app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = parseInt(process.env.PORT, 10) || 3000;
  app.listen(PORT, () => {
    console.log(`\n ${AGENT_NAME} is LIVE on port ${PORT}`);
    console.log(` Stats   GET http://localhost:${PORT}/api/stats`);
    console.log(` Leads   GET http://localhost:${PORT}/api/leads`);
    console.log(` QR SSE  GET http://localhost:${PORT}/api/whatsapp/qr-stream`);
    console.log(` Health  GET http://localhost:${PORT}/health\n`);
  });
}

process.on('SIGINT', async () => {
  await mongoose.disconnect();
  process.exit(0);
});

startServer().catch((err) => {
  console.error(' Startup failed:', err.message);
  process.exit(1);
});
