'use strict';

/**
 * â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
 * â•‘       STEMS CALL AGENT â€” Production Server           â•‘
 * â•‘       Powered by Vapi AI + Claude                    â•‘
 * â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *
 * Features:
 *  âœ… Outbound AI calls â€” agent khud call karta hai
 *  âœ… Inbound calls handle karta hai
 *  âœ… Claude se real-time conversation
 *  âœ… Call summary + transcript auto-save
 *  âœ… Lead score update after call
 *  âœ… Excel/CSV se bulk calling campaign
 *  âœ… Shared lead DB with WhatsApp + Email agents
 *
 * Run:  node call-agent.js
 * Port: 3002
 */

const express   = require('express');
const axios     = require('axios');
const mongoose  = require('mongoose');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const cron      = require('node-cron');
const XLSX      = require('xlsx');
const fs        = require('fs');
const path      = require('path');
require('dotenv').config();

const { Lead, Conversation } = require('./models/shared');

// â”€â”€ Validate env â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
['MONGODB_URI'].forEach((k) => {
  if (!process.env[k]) { console.error(`âŒ Missing env: ${k}`); process.exit(1); }
});
if (!process.env.VAPI_PRIVATE_KEY) {
  console.warn('⚠️ VAPI_PRIVATE_KEY missing in environment. Per-user Vapi keys are required for outbound calls.');
}

const VAPI_API    = 'https://api.vapi.ai';
const AGENT_NAME  = 'Stems Call Agent';
const CALL_PORT   = parseInt(process.env.CALL_PORT) || 3002;
const DEFAULT_OWNER = (process.env.PRIMARY_OWNER_EMAIL || 'samerkarwande3@gmail.com').trim().toLowerCase();
const OWNER_HEADER = 'x-owner-email';

function ownerFromReq(req) {
  return (req.headers[OWNER_HEADER] || req.query.owner || req.body?.owner || DEFAULT_OWNER).toString().trim().toLowerCase();
}

function ownerScope(ownerEmail) {
  const owner = (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase();
  return { owner_email: owner, user_id: owner };
}

function buildVapiClient(callConfig = {}) {
  const apiKey = (callConfig.vapi_api_key || process.env.VAPI_PRIVATE_KEY || '').trim();
  if (!apiKey) throw new Error('Vapi API key missing for this user.');
  return axios.create({
    baseURL: VAPI_API,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

// â”€â”€ Call Log Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const callLogSchema = new mongoose.Schema({
  vapiCallId:   String,
  to:           String,
  from:         String,
  owner_email:  { type: String, index: true, default: DEFAULT_OWNER },
  user_id:      { type: String, index: true, default() { return this.owner_email || DEFAULT_OWNER; } },
  status:       { type: String, default: 'initiated' },
  rawStatus:    String,
  duration:     Number,   // seconds
  transcript:   String,
  conversation_text: String,
  summary:      String,
  recordingUrl: String,
  recording_url: String,
  campaign:     String,
  createdAt:    { type: Date, default: Date.now },
  endedAt:      Date,
});
callLogSchema.index({ owner_email: 1, user_id: 1, createdAt: -1 });
callLogSchema.index({ owner_email: 1, user_id: 1, vapiCallId: 1 });
const CallLog = mongoose.model('CallLog', callLogSchema);

function normalizeCallStatus(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return 'initiated';
  if (['queued', 'initiated'].includes(s)) return 'initiated';
  if (['ringing'].includes(s)) return 'ringing';
  if (['in-progress', 'in_progress', 'ongoing'].includes(s)) return 'in-progress';
  if (['completed', 'ended', 'customer-ended-call', 'assistant-ended-call', 'success'].includes(s)) return 'completed';
  if (['no-answer', 'no_answer', 'unanswered'].includes(s)) return 'no-answer';
  if (['busy'].includes(s)) return 'busy';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  return s;
}


// â”€â”€ Vapi Assistant Config â€” Stems Sales Agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildAssistantConfig(lead) {
  const name     = lead.name     || 'bhai';
  const business = lead.business || 'aapka business';
  const location = lead.location || 'India';
  const agentName = (lead.agent_name || lead.agentName || 'AI Assistant').toString().trim();
  const companyName = (lead.business_name || lead.businessName || 'your business').toString().trim();

  return {
    name:  `${agentName} - ${companyName}`,
    model: {
      provider:    'openai',
      model:       'gpt-4o-mini',
      temperature: 0.75,
      messages: [{
        role:    'system',
        content: (`You are Arjun — a sharp, confident sales consultant at Stems Sales Agency, India.
You are calling ${name} who runs ${business} based in ${location}.
This is a real phone call. Speak naturally, like a smart Indian professional — warm but direct.

=== YOUR MISSION ===
Book a FREE 15-minute strategy consultation call.
You are NOT selling immediately. You are building curiosity and trust.

=== STEMS SALES AGENCY — WHAT WE DO ===
We help Indian businesses generate high-quality leads and automate their sales pipeline using AI.
Results our clients see:
• 3x more qualified leads within 60 days
• 40–60% reduction in cost per lead
• Automated WhatsApp + Email + Call follow-ups — zero manual work
• Full CRM + AI reply system included
Clients: Real estate, EdTech, Clinics, D2C brands, SaaS, Agencies

=== CONVERSATION STYLE ===
• SPEAK SHORT — max 1-2 sentences per turn on a phone call
• Ask ONE question at a time — never two
• Hinglish is fine — mix naturally like a real Indian professional
• Sound curious and interested, not robotic
• Use their name naturally: "${name} bhai" or just "${name}"
• Mirror their language — if they speak Hindi, lean Hindi. English, lean English.
• NEVER say you are AI, bot, or automated
• NEVER sound like you are reading a script
• Use natural fillers: "dekho", "suno", "basically", "matlab", "haan bilkul"

=== HIGH-CONVERTING CALL FLOW ===

STEP 1 — OPEN STRONG (first 15 seconds):
"Hello ${name}! Main Arjun bol raha hoon Stems Sales Agency se — Mumbai mein hain hum.
Aapke business ke baare mein thoda research kiya tha — 2 minute ho sakta hai abhi?"

STEP 2 — QUALIFY THE PAIN (most important step):
"${name} bhai, ek seedha sawaal — aapke business mein currently leads ka kya scene hai?
Matlab — leads aa rahi hain ya woh problem hai, ya aati hain par convert nahi hoti?"

[LISTEN CAREFULLY. Their answer is your entire pitch.]

STEP 3 — EMPATHIZE + SPIKE CURIOSITY:
If leads not coming: "Haan, yeh bahut common problem hai — especially [their industry] mein.
Humne kuch clients ke liye exactly yahi solve kiya — 45 din mein unki leads 3x ho gayi.
Honestly bolunga — main directly sales nahi karna chahta. Ek free call mein aapka full situation dekh ke
batata hoon kya possible hai aapke case mein. Theek lagta hai?"

If leads not converting: "Conversion problem usually 2 cheezein hoti hain — ya toh follow-up late hota hai,
ya leads warm nahi hoti. Humara AI system yeh dono automate karta hai — WhatsApp, email, call — sab.
Ek 15-minute free session mein main aapko exact breakdown de sakta hoon. Kab free ho — kal ya parson?"

STEP 4 — HANDLE OBJECTIONS LIKE A PRO:

"Not interested" →
"Bilkul samajh gaya ${name} bhai. Ek last cheez — aapke business mein leads ki koi problem hai ya
sab smooth chal raha hai? Sirf genuinely jaanna chahta tha — no pressure at all."

"Already have someone" →
"Oh nice! Kaunsa system use kar rahe ho — in-house ya koi agency? [PAUSE — let them answer]
Achha. Aur results kaisa aa raha hai unse — satisfied ho ya kuch missing feel hota hai?"

"Too expensive / budget nahi" →
"Haan, that's fair ${name} bhai. Actually — abhi cost ki baat karna thoda jaldi hogi.
Pehle ek 15-minute free call mein dekho kya possible hai aapke liye — zero commitment, zero cost.
Uske baad decide karna. Kal 11 baje theek rahega?"

"Call later / busy" →
"Of course! Aap busy ho — main samajhta hoon. Kal specifically kab free ho — subah ya shaam?
Main same time pe call kar leta hoon — 2 minute se zyada nahi lunga."

"Who are you?" →
"Main Arjun hoon — Stems Sales Agency se. Hum Indian businesses ke liye AI-powered lead generation
aur sales automation karte hain. Aapke [business type] mein kuch kaam aa sakta hai — isliye call kiya."

"Send WhatsApp / Email first" →
"Bilkul bhejta hoon! Ek kaam karo — kal subah check karna. Aur agar koi specific cheez jaanni ho
toh seedha reply karo — main personally handle karta hoon. Number same pe hoon."

STEP 5 — CLOSE FOR THE CALL:
"${name} bhai — 15-minute ka ek free strategy session karte hain. No pitch, no pressure.
Main genuinely aapka business dekh ke bataunga kya possible hai.
Kal 11 baje theek hai, ya koi aur time better rahega?"

=== CRITICAL RULES ===
✓ If they agree to a callback time — confirm it enthusiastically and end professionally
✓ If they say no 3 times — thank them warmly and offer WhatsApp follow-up
✓ Always end with sending WhatsApp details promise
✓ Keep total call under 4 minutes unless they are very engaged
✓ Energy should stay high but NEVER pushy — consultative always`)
          .replaceAll('Arjun', agentName)
          .replaceAll('Stems Sales Agency', companyName),
      }],
    },
    voice: {
      provider:                 '11labs',
      voiceId:                  'lOJWQNMBIzoU3N0EnOya',
      stability:                0.45,
      similarityBoost:          0.88,
      style:                    0.35,
      useSpeakerBoost:          true,
      optimizeStreamingLatency: 3,
    },
    transcriber: {
      provider:    'deepgram',
      model:       'nova-2',
      language:    'hi',
      smartFormat: true,
      endpointing: 60,
    },
    firstMessage: `Hello ${name}! Main ${agentName} bol raha hoon ${companyName} se — abhi 2 minute available hain?`,
    endCallMessage: `Bilkul ${name} bhai! WhatsApp pe details bhejta hoon abhi. Bahut accha laga baat karke — take care!`,
    endCallPhrases: ['bye', 'goodbye', 'alvida', 'ok bye', 'band karo', 'rakh do', 'chhodo', 'baad mein karo', 'mat karo call'],
    maxDurationSeconds:          360,
    backgroundSound:             'off',
    backgroundDenoisingEnabled:  true,
    recordingEnabled:            true,
    silenceTimeoutSeconds:       12,
    numWordsToInterruptAssistant: 1,
    startSpeakingPlan: {
      waitSeconds:             0.05,
      smartEndpointingEnabled: true,
    },
    stopSpeakingPlan: {
      numWords:       1,
      voiceSeconds:   0.1,
      backoffSeconds: 0.5,
    },
    analysisPlan: {
      summaryPrompt: `Analyze this Indian B2B sales call. Answer:
1. Was the prospect interested? (yes/no/maybe)
2. What is their main pain point with leads?
3. What objection did they raise?
4. What was agreed as next step?
5. Lead quality: hot / warm / cold
Keep it under 4 lines.`,
      structuredDataSchema: {
        type: 'object',
        properties: {
          interested:          { type: 'boolean' },
          lead_quality:        { type: 'string', enum: ['hot', 'warm', 'cold'] },
          pain_point:          { type: 'string' },
          main_objection:      { type: 'string' },
          next_step:           { type: 'string' },
          callback_requested:  { type: 'boolean' },
          callback_time:       { type: 'string' },
        },
      },
      successEvaluationPrompt: 'Was this call successful? Did the prospect agree to a callback, show genuine interest, or ask for details?',
    },
  };
}

async function makeCall(lead, campaign = 'manual', ownerEmail = DEFAULT_OWNER, callConfig = {}) {
  const owner = (ownerEmail || DEFAULT_OWNER).toString().trim().toLowerCase();
  const phone = lead.phone || lead.userId;
  if (!phone) throw new Error('Phone number required');

  console.log(`ðŸ“ž Calling ${lead.name || phone} (${phone})...`);

  const assistantId = (callConfig.vapi_assistant_id || process.env.VAPI_ASSISTANT_ID || '').trim();
  const phoneNumberId = (callConfig.vapi_phone_number_id || process.env.VAPI_PHONE_NUMBER_ID || '').trim();
  if (!assistantId) {
    throw new Error('Vapi assistant ID is missing for this user.');
  }
  if (!phoneNumberId) {
    throw new Error('Vapi phone number ID is missing for this user.');
  }
  console.log(`🎛️ Using Vapi assistantId from dashboard: ${assistantId}`);

  const payload = {
    phoneNumberId,
    customer: {
      number: phone.startsWith('+') ? phone : `+${phone}`,
      name:   lead.name || '',
    },
    assistantId,
    assistantOverrides: { serverMessages: ['end-of-call-report', 'status-update', 'transcript'] },
  };

  const vapi = buildVapiClient(callConfig);
  const response = await vapi.post('/call/phone', payload);

  const callId = response.data?.id;

  // Save call log
  await CallLog.create({
    vapiCallId: callId,
    to:         phone,
    owner_email: owner,
    user_id: owner,
    status:     'initiated',
    campaign,
  });

  // Update lead
  await Lead.findOneAndUpdate(
    { owner_email: owner, user_id: owner, phone: phone },
    { $set: { lastInteraction: new Date(), source: lead.source || 'call', phone: phone, owner_email: owner, user_id: owner } },
    { upsert: true },
  );

  console.log(`âœ… Call initiated | ID: ${callId}`);
  return { callId, phone, status: 'initiated' };
}


// â”€â”€ Express App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startCallAgent() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('âœ…  MongoDB connected');

  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Owner-Email');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

  // â”€â”€ Vapi Webhook â€” call events â”€â”€
  // Set in Vapi Dashboard â†’ API Keys â†’ Server URL
  app.post('/webhook/vapi', async (req, res) => {
    res.sendStatus(200);
    const event = req.body;
    const type  = event?.message?.type;
    console.log(`ðŸ“ž Vapi event: ${type}`);

    try {
      if (type === 'end-of-call-report') {
        const report   = event.message;
        const callId   = report?.call?.id;
        const phone    = report?.call?.customer?.number;
        const duration = report?.durationSeconds || 0;
        const endedReason = report?.endedReason;
        const normalizedStatus = normalizeCallStatus(endedReason || report?.status || 'completed');
        const transcriptText = report?.transcript || '';
        const recordingUrl = report?.recordingUrl || report?.recording?.stereoUrl || report?.recording?.monoUrl || '';
        const existingCall = callId ? await CallLog.findOne({ vapiCallId: callId }).lean() : null;
        const owner = (existingCall?.owner_email || DEFAULT_OWNER).toString().trim().toLowerCase();

        await CallLog.findOneAndUpdate(
          { vapiCallId: callId },
          {
            $set: {
              owner_email: owner,
              user_id: owner,
              status:       normalizedStatus,
              rawStatus:    endedReason || report?.status || '',
              duration,
              transcript:   transcriptText,
              conversation_text: transcriptText,
              summary:      report?.analysis?.summary,
              recordingUrl,
              recording_url: recordingUrl,
              endedAt:      new Date(),
            },
          },
          { upsert: false }
        );

        // Save transcript as conversation
        if (phone && transcriptText) {
          await Conversation.create({
            leadId:  phone,
            channel: 'call',
            role:    'user',
            content: transcriptText,
            owner_email: owner,
            user_id: owner,
          });
        }

        // Update lead score if interested
        const interested = report?.analysis?.structuredData?.interested;
        if (interested) {
          await Lead.findOneAndUpdate(
            { owner_email: owner, user_id: owner, phone: phone },
            { $inc: { leadScore: 25 }, $set: { status: 'hot', lastInteraction: new Date(), owner_email: owner, user_id: owner } },
          );
          console.log(`ðŸ”¥ HOT LEAD from call: ${phone}`);
        }

        console.log(`ðŸ“Š Call ended | Duration: ${duration}s | Summary: ${report?.analysis?.summary}`);
      }

      if (type === 'status-update') {
        const callId = event.message?.call?.id;
        const status = event.message?.status;
        const existingCall = callId ? await CallLog.findOne({ vapiCallId: callId }).lean() : null;
        const owner = (existingCall?.owner_email || DEFAULT_OWNER).toString().trim().toLowerCase();
        await CallLog.findOneAndUpdate(
          { vapiCallId: callId },
          { $set: { owner_email: owner, user_id: owner, status: normalizeCallStatus(status), rawStatus: status || '' } },
          { upsert: false }
        );
      }

    } catch (e) {
      console.error('Webhook error:', e.message);
    }
  });


  // â”€â”€ API: Single outbound call â”€â”€
  // POST /api/calls/make  { "phone": "...", "name": "...", "business": "..." }
  app.post('/api/calls/make', async (req, res) => {
    const owner = ownerFromReq(req);
    const {
      phone, name, business, location,
      provider_mode, vapi_api_key, vapi_assistant_id, vapi_phone_number_id,
      twilio_account_sid, twilio_auth_token, twilio_phone_number,
    } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    try {
      const result = await makeCall(
        { phone, name, business, location },
        'manual',
        owner,
        {
          provider_mode,
          vapi_api_key,
          vapi_assistant_id,
          vapi_phone_number_id,
          twilio_account_sid,
          twilio_auth_token,
          twilio_phone_number,
        }
      );
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  // POST /api/call  (alias)
  app.post('/api/call', async (req, res) => {
    const owner = ownerFromReq(req);
    const {
      phone, name, business, location,
      provider_mode, vapi_api_key, vapi_assistant_id, vapi_phone_number_id,
      twilio_account_sid, twilio_auth_token, twilio_phone_number,
    } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    try {
      const result = await makeCall(
        { phone, name, business, location },
        'manual',
        owner,
        {
          provider_mode,
          vapi_api_key,
          vapi_assistant_id,
          vapi_phone_number_id,
          twilio_account_sid,
          twilio_auth_token,
          twilio_phone_number,
        }
      );
      res.json({ success: true, ...result });
    } catch (e) {
      console.error(e.response?.data || e.message);
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  // â”€â”€ API: Bulk call campaign from JSON list â”€â”€
  // POST /api/call/campaign  { "leads": [...], "gapSeconds": 60 }
  app.post('/api/call/campaign', async (req, res) => {
    const owner = ownerFromReq(req);
    const { leads, gapSeconds = 60, campaign = 'bulk_campaign' } = req.body;
    if (!leads?.length) return res.status(400).json({ error: 'leads array required' });

    res.json({ success: true, total: leads.length, status: 'Campaign started in background' });

    // Run in background
    (async () => {
      let called = 0, failed = 0;
      for (const lead of leads) {
        try {
          await makeCall(lead, campaign, owner);
          called++;
          await new Promise((r) => setTimeout(r, gapSeconds * 1000));
        } catch (e) {
          failed++;
          console.error(`Call failed for ${lead.phone}:`, e.message);
        }
      }
      console.log(`ðŸ“¢ Call campaign done â€” called: ${called}, failed: ${failed}`);
    })();
  });

  // â”€â”€ API: Import Excel and call everyone â”€â”€
  // POST /api/call/excel  { "filePath": "leads.xlsx" }
  app.post('/api/call/excel', async (req, res) => {
    const owner = ownerFromReq(req);
    const { filePath, gapSeconds = 60 } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });

    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

    const wb    = XLSX.readFile(fullPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const leads = rows.map((row) => {
      const r = {};
      Object.keys(row).forEach((k) => { r[k.toLowerCase().trim()] = String(row[k]).trim(); });
      return {
        phone:    r.phone || r.mobile || r.number || r.contact || '',
        name:     r.name  || r.fullname || '',
        business: r.business || r.company || 'Business Owner',
        location: r.location || r.city || 'India',
      };
    }).filter((l) => l.phone);

    res.json({ success: true, total: leads.length, status: 'Excel call campaign started' });

    (async () => {
      let called = 0, failed = 0;
      for (const lead of leads) {
        try {
          await makeCall(lead, 'excel_campaign', owner);
          called++;
          await new Promise((r) => setTimeout(r, gapSeconds * 1000));
        } catch (e) {
          failed++;
          console.error(`Call failed ${lead.phone}:`, e.message);
        }
      }
      console.log(`ðŸ“¢ Excel call campaign done â€” called: ${called}, failed: ${failed}`);
    })();
  });


  // â”€â”€ API: Get all call logs â”€â”€
  app.get('/api/calls', async (req, res) => {
    const owner = ownerFromReq(req);
    const calls = await CallLog.find(ownerScope(owner)).sort({ createdAt: -1 }).limit(200).lean();
    res.json(calls);
  });

  // â”€â”€ API: Get single call details â”€â”€
  app.get('/api/calls/:callId', async (req, res) => {
    const owner = ownerFromReq(req);
    const call = await CallLog.findOne({ vapiCallId: req.params.callId, ...ownerScope(owner) }).lean();
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  });

  // â”€â”€ Stats â”€â”€
  app.get('/api/stats', async (req, res) => {
    const owner = ownerFromReq(req);
    const scope = ownerScope(owner);
    const [total, completed, failed, hotLeads] = await Promise.all([
      CallLog.countDocuments(scope),
      CallLog.countDocuments({ ...scope, status: 'completed' }),
      CallLog.countDocuments({ ...scope, status: 'failed' }),
      Lead.countDocuments({ ...scope, leadScore: { $gte: 70 } }),
    ]);
    const avgDur = await CallLog.aggregate([
      { $match: { ...scope, status: 'completed' } },
      { $group: { _id: null, avg: { $avg: '$duration' } } },
    ]);
    res.json({
      agent: AGENT_NAME,
      totalCalls: total,
      completed,
      failed,
      noAnswer:   total - completed - failed,
      avgDurationSecs: Math.round(avgDur[0]?.avg || 0),
      hotLeadsFromCalls: hotLeads,
    });
  });

  // â”€â”€ Health â”€â”€
  app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_NAME, ts: new Date() }));

  // â”€â”€ Cron: Call hot leads daily @ 11 AM â”€â”€
  cron.schedule('0 11 * * *', async () => {
    const hour = new Date().getHours();
    if (hour < 9 || hour > 20) return; // don't call outside business hours

    const hotLeads = await Lead.find({
      ...ownerScope(DEFAULT_OWNER),
      phone:           { $exists: true, $ne: '' },
      leadScore:       { $gte: 70 },
      status:          { $nin: ['converted', 'lost'] },
      lastInteraction: { $lt: new Date(Date.now() - 2 * 86_400_000) },
    }).lean();

    console.log(`ðŸ“ž Auto-calling ${hotLeads.length} hot leads`);
    for (const lead of hotLeads) {
      try {
        await makeCall(lead, 'auto_hot_lead', DEFAULT_OWNER);
        await new Promise((r) => setTimeout(r, 60_000)); // 1 min gap
      } catch (e) { console.error(`Auto-call failed ${lead.phone}:`, e.message); }
    }
  });

  // â”€â”€ Error handler â”€â”€
  app.use((err, _req, res, _next) => {
    console.error('Call Agent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(CALL_PORT, () => {
    console.log(`\nðŸ“ž  ${AGENT_NAME} is LIVE on port ${CALL_PORT}`);
    console.log(`ðŸ“Œ  Vapi Webhook  â†’ POST https://your-domain.com/webhook/vapi`);
    console.log(`ðŸ“Š  Stats         â†’ GET  http://localhost:${CALL_PORT}/api/stats`);
    console.log(`ðŸ“‹  Call Logs     â†’ GET  http://localhost:${CALL_PORT}/api/calls`);
    console.log(`â¤ï¸   Health        â†’ GET  http://localhost:${CALL_PORT}/health\n`);
  });
}

process.on('SIGINT', async () => { await mongoose.disconnect(); process.exit(0); });
startCallAgent().catch((e) => { console.error('âŒ Startup failed:', e.message); process.exit(1); });


