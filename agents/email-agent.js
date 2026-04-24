'use strict';

/**
 * 
 *         STEMS EMAIL AGENT  Production Server         
 *         Powered by Resend API + Claude                
 * 
 *
 * Run:  node email-agent.js
 * Dev:  nodemon email-agent.js
 * Port: 3001 (WhatsApp agent runs on 3000)
 *
 * Features:
 *   Inbound email replies  AI responds automatically
 *   Outbound cold email campaigns
 *   AI-powered personalised email writing
 *   Follow-up sequences (Day 1, 3, 7)
 *   Shared lead DB with WhatsApp agent
 *   Open/reply tracking via Resend webhooks
 */

const express   = require('express');
const mongoose  = require('mongoose');
const nodemailer = require('nodemailer');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const cron       = require('node-cron');
require('dotenv').config();

const { claude, Lead, Conversation, EmailLog } = require('./models/shared');

//  Validate env 
['CLAUDE_API_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'MONGODB_URI'].forEach((k) => {
  if (!process.env[k]) { console.error(` Missing env: ${k}`); process.exit(1); }
});

// Gmail SMTP transporter
const defaultTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const FROM_EMAIL = process.env.GMAIL_USER;
const FROM_NAME  = process.env.GMAIL_FROM_NAME || 'Sales Assistant';
const AGENT_NAME = 'Stems Email Agent';
const PRIMARY_OWNER = (process.env.PRIMARY_OWNER_EMAIL || 'samerkarwande3@gmail.com').trim().toLowerCase();
const OWNER_HEADER = 'x-owner-email';
const transportCache = new Map();

function ownerFromReq(req) {
  return (req.headers[OWNER_HEADER] || req.query.owner || req.body?.owner || PRIMARY_OWNER).toString().trim().toLowerCase();
}

function ownerScope(ownerEmail, extra = {}) {
  const owner = (ownerEmail || PRIMARY_OWNER).toString().trim().toLowerCase();
  return { ...extra, owner_email: owner, user_id: owner };
}

async function resolveOwnerContext(ownerEmail) {
  const owner = (ownerEmail || PRIMARY_OWNER).toString().trim().toLowerCase();
  const user = await mongoose.connection.collection('users')
    .findOne({ email: owner }, { projection: { agent_name: 1, business_name: 1, business_description: 1 } })
    .catch(() => null);
  return {
    agentName: String(user?.agent_name || 'AI Assistant').trim() || 'AI Assistant',
    businessName: String(user?.business_name || 'Your Business').trim() || 'Your Business',
    businessDescription: String(user?.business_description || '').trim(),
  };
}

function getTransporter(authUser, authPass) {
  const u = (authUser || '').trim();
  const p = (authPass || '').trim();
  if (!u || !p) return defaultTransporter;
  const key = `${u}::${p}`;
  if (!transportCache.has(key)) {
    transportCache.set(key, nodemailer.createTransport({
      service: 'gmail',
      auth: { user: u, pass: p },
    }));
  }
  return transportCache.get(key);
}

async function resolveSenderConfig(ownerEmail) {
  const owner = (ownerEmail || '').trim().toLowerCase();
  const query = owner === PRIMARY_OWNER
    ? { type: 'email', $or: [ownerScope(owner), { owner_email: { $exists: false }, user_id: { $exists: false } }] }
    : ownerScope(owner, { type: 'email' });
  const agent = await mongoose.connection.collection('agents').findOne(query, { projection: { credentials: 1 } });
  const credentials = agent?.credentials || {};
  const senderEmail = (credentials.email || FROM_EMAIL || '').trim();
  const senderName = (credentials.from_name || process.env.GMAIL_FROM_NAME || FROM_NAME || 'Sales Assistant').trim();
  const appPassword = (credentials.app_password || credentials.gmail_app_password || '').trim();
  const smtpUser = (credentials.smtp_user || (appPassword ? senderEmail : FROM_EMAIL) || FROM_EMAIL).trim();
  const smtpPass = (credentials.smtp_pass || appPassword || process.env.GMAIL_APP_PASSWORD || '').trim();
  return { senderEmail, senderName, smtpUser, smtpPass, credentials };
}

//  AI Email Writer 
class EmailAgent {

  async writeEmail(lead, emailType = 'cold_outreach', sender = {}, context = {}) {
    const name     = lead.name     || 'there';
    const business = lead.business || 'your business';
    const location = lead.location || 'India';
    const senderName = sender.name || FROM_NAME;
    const senderEmail = sender.email || FROM_EMAIL;
    const agentName = context.agentName || senderName || 'AI Assistant';
    const businessName = context.businessName || 'Your Business';
    const businessDescription = context.businessDescription || 'AI-powered lead generation and sales automation.';

    const prompts = {

      cold_outreach: `You are a world-class B2B copywriter writing a cold outreach email for ${businessName}.

SENDER: ${senderName} | ${senderEmail}
COMPANY: ${businessName}  ${businessDescription}

PROSPECT:
- Name: ${name}
- Business: ${business}
- Location: ${location}

WHAT WE DELIVER (use specific numbers):
 3x more qualified leads within 60 days
 40-60% reduction in cost per lead
 Fully automated WhatsApp + Email + Call follow-ups
 AI replies to every lead instantly  24/7
 Zero additional staff needed

EMAIL RULES:
1. Subject: Create STRONG curiosity  max 8 words. Do NOT use "leads", "sales", "agency" in subject.
   Good examples: "Quick question about ${business}", "Saw something interesting about your ads", 
   "This might explain your conversion drop", "3x leads  done for [City] businesses"
2. Opening: Address them by name, reference their specific business type or city  make it feel researched
3. Body: Max 5 lines. One specific pain point. One specific result with a number. One CTA.
4. Tone: Confident, warm, peer-to-peer  NOT corporate, NOT salesy
5. CTA: One clear ask  a 15-minute free strategy call. Make it low-commitment.
6. NO "I hope this email finds you well"
7. NO "Please let me know if you're interested"
8. NO bullet points in email body  flowing prose only
9. Language: English with natural warmth. If name sounds Indian, you can add slight warmth.
10. P.S. line: Add one powerful P.S. with a specific result or social proof

Return ONLY valid JSON (no markdown, no backticks):
{"subject": "...", "body": "..."}`,

      followup_day3: `You are writing a follow-up email (Day 3) for ${businessName}.
First email was sent 3 days ago  no reply yet.

PROSPECT: ${name} | ${business}
SENDER: ${senderName}

RULES:
- Reference the first email naturally  "Wanted to follow up on my email from a few days back"
- Add NEW value  a different angle, a stat, or a quick insight they haven't heard
- 3 lines MAX. Make every word count.
- Do NOT apologize for following up
- End with a different CTA angle  e.g., "Even a 10-minute chat would be worth it"
- Slightly more casual tone than first email

Return ONLY valid JSON:
{"subject": "...", "body": "..."}`,

      followup_day7: `You are writing the final "breakup" follow-up email (Day 7) for ${businessName}.

PROSPECT: ${name} | ${business}
SENDER: ${senderName}

RULES:
- This is the LAST email in the sequence
- 2 lines ONLY  ultra short
- Make it feel human and slightly vulnerable: "I'll stop reaching out after this..."
- Leave door open with dignity  no pressure, genuine offer
- The goal is to trigger a reply out of guilt or curiosity
- Classic breakup email pattern: "I'm going to assume the timing isn't right..."

Return ONLY valid JSON:
{"subject": "...", "body": "..."}`,

      reply: `You are ${agentName} from ${businessName}, replying to a prospect's email.

PROSPECT: ${name}
THEIR MESSAGE: ${lead._replyBody || ''}
ORIGINAL SUBJECT: ${lead._replySubject || ''}

RULES:
- Match their energy and tone exactly
- If they asked a question  answer it directly and confidently, then steer to a call
- If they showed interest  capitalize immediately, offer a specific time slot
- If they pushed back  acknowledge, reframe the value, then ask a question back
- 4-5 lines MAX
- End with a question or a specific call-to-action
- Sound like a real person, not a bot

Return ONLY valid JSON:
{"subject": "Re: ${lead._replySubject || ''}", "body": "..."}`,

    };

    const response = await claude.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompts[emailType] }],
    });

    let raw = response.content[0].text.trim();
    raw = raw.replace(/```json|```/g, '').trim();

    // Extract JSON safely
    const first = raw.indexOf('{');
    const last  = raw.lastIndexOf('}');
    if (first !== -1 && last > first) {
      raw = raw.substring(first, last + 1);
    }

    return JSON.parse(raw);
  }

  async sendEmail(to, subject, body, sender = {}, customTransporter = null, context = {}) {
    const senderName = sender.name || FROM_NAME;
    const senderEmail = sender.email || FROM_EMAIL;
    const tx = customTransporter || defaultTransporter;
    const info = await tx.sendMail({
      from:    `"${senderName}" <${senderEmail}>`,
      replyTo: senderEmail,
      to,
      subject,
      html:    this._toHtml(body, senderName, senderEmail, context),
      text:    body,
    });
    console.log(`Email sent to ${to} | Subject: ${subject} | ID: ${info.messageId}`);
    return info;
  }

  _toHtml(body, senderName = FROM_NAME, senderEmail = FROM_EMAIL, context = {}) {
    const companyName = context.businessName || 'Your Business';
    const companyDescription = context.businessDescription || 'AI-Powered Growth';
    const agentName = context.agentName || senderName || 'AI Assistant';
    const avatarLetter = (agentName || 'A').trim().slice(0, 1).toUpperCase() || 'A';
    const paragraphs = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        if (line.startsWith('P.S.') || line.startsWith('PS.') || line.startsWith('P.S ')) {
          return `<p style="margin:20px 0 0;padding:16px;background:#f8f9ff;border-left:3px solid #4f46e5;border-radius:4px;font-size:13px;color:#374151;line-height:1.6">${line}</p>`;
        }
        return `<p style="margin:0 0 14px;line-height:1.7;color:#374151">${line}</p>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${senderName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px">
<tr><td align="center">

  <!-- Card -->
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <!-- Header Bar -->
    <tr>
      <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:24px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">${companyName}</p>
              <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase">${companyDescription}</p>
            </td>
            <td align="right">
              <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px 14px;display:inline-block">
                <p style="margin:0;font-size:11px;color:#ffffff;font-weight:600">FROM ${String(senderName).toUpperCase()}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:36px 32px 24px">
        <div style="font-size:15px;color:#374151;line-height:1.8">
          ${paragraphs}
        </div>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding:0 32px">
        <div style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent)"></div>
      </td>
    </tr>

    <!-- Signature -->
    <tr>
      <td style="padding:24px 32px">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="width:44px;height:44px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:18px;text-align:center;line-height:44px">${avatarLetter}</div>
            </td>
            <td style="padding-left:14px">
              <p style="margin:0;font-weight:600;font-size:14px;color:#111827">${agentName}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#6b7280">Growth Consultant  ${companyName}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#4f46e5">${senderEmail}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Stats Bar -->
    <tr>
      <td style="background:#fafafa;border-top:1px solid #f3f4f6;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="border-right:1px solid #e5e7eb;padding:0 16px 0 0">
              <p style="margin:0;font-size:20px;font-weight:700;color:#4f46e5">3x</p>
              <p style="margin:2px 0 0;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">More Leads</p>
            </td>
            <td align="center" style="border-right:1px solid #e5e7eb;padding:0 16px">
              <p style="margin:0;font-size:20px;font-weight:700;color:#4f46e5">60%</p>
              <p style="margin:2px 0 0;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">Lower Cost</p>
            </td>
            <td align="center" style="padding:0 0 0 16px">
              <p style="margin:0;font-size:20px;font-weight:700;color:#4f46e5">24/7</p>
              <p style="margin:2px 0 0;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">AI Follow-up</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:16px 32px;border-radius:0 0 12px 12px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;color:#9ca3af">
                 2025 ${companyName} 
                <a href="https://stems-frontend-theta.vercel.app" style="color:#4f46e5;text-decoration:none">stems-frontend-theta.vercel.app</a>
              </p>
            </td>
            <td align="right">
              <p style="margin:0;font-size:11px;color:#d1d5db">
                <a href="mailto:${senderEmail}?subject=UNSUBSCRIBE" style="color:#9ca3af;text-decoration:none">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>

</td></tr>
</table>

</body>
</html>`;
  }
}

const emailAgent = new EmailAgent();

//  Express App 
async function startEmailAgent() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('  MongoDB connected');

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

  //  Resend Webhook  inbound email reply received 
  // Set in Resend Dashboard  Webhooks  email.replied
  app.post('/webhook/resend', async (req, res) => {
    res.sendStatus(200);
    const event = req.body;
    console.log(' Resend webhook:', event?.type);

    if (event?.type === 'email.replied') {
      handleInboundReply(event).catch(console.error);
    }
    if (event?.type === 'email.opened') {
      await EmailLog.findOneAndUpdate(
        { resendId: event?.data?.email_id },
        { $set: { status: 'opened' } }
      );
    }
  });

  //  Health 
  app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_NAME, ts: new Date() }));

  //  Send single email 
  // POST /api/email/send  { "to": "lead@email.com", "name": "Rahul", "business": "Real estate" }
  app.post('/api/email/send', async (req, res) => {
    const owner = ownerFromReq(req);
    const { to, name, business, location, type = 'cold_outreach' } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required' });
    try {
      const sender = await resolveSenderConfig(owner);
      const context = await resolveOwnerContext(owner);
      if (
        sender.senderEmail &&
        sender.senderEmail.toLowerCase() !== (sender.smtpUser || '').toLowerCase() &&
        !sender.credentials?.smtp_pass &&
        !sender.credentials?.app_password &&
        !sender.credentials?.gmail_app_password
      ) {
        return res.status(400).json({
          error: `Configured sender ${sender.senderEmail} needs app_password to send from this mailbox.`,
        });
      }
      const tx = getTransporter(sender.smtpUser, sender.smtpPass);
      const senderInfo = { name: sender.senderName, email: sender.senderEmail || sender.smtpUser || FROM_EMAIL };
      const lead = { name, business, location };
      const { subject, body } = await emailAgent.writeEmail(lead, type, senderInfo, context);
      const result = await emailAgent.sendEmail(to, subject, body, senderInfo, tx, context);

      await EmailLog.create(ownerScope(owner, { to, from: senderInfo.email, subject, body, resendId: result.messageId, campaign: type }));
      await Lead.findOneAndUpdate(
        ownerScope(owner, { email: to }),
        { $set: ownerScope(owner, { email: to, name, business, location, source: 'email', lastInteraction: new Date() }) },
        { upsert: true }
      );
      res.json({ success: true, subject, messageId: result.messageId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  //  Bulk email campaign 
  // POST /api/email/campaign  { "leads": [...], "type": "cold_outreach" }
  app.post('/api/email/campaign', async (req, res) => {
    const owner = ownerFromReq(req);
    const { leads, type = 'cold_outreach' } = req.body;
    if (!leads?.length) return res.status(400).json({ error: 'leads array required' });

    res.json({ success: true, total: leads.length, status: 'Campaign started in background' });

    // Run in background
    (async () => {
      const sender = await resolveSenderConfig(owner);
      const context = await resolveOwnerContext(owner);
      const tx = getTransporter(sender.smtpUser, sender.smtpPass);
      const senderInfo = { name: sender.senderName, email: sender.senderEmail || sender.smtpUser || FROM_EMAIL };
      let sent = 0, failed = 0;
      for (const lead of leads) {
        try {
          const { subject, body } = await emailAgent.writeEmail(lead, type, senderInfo, context);
          const result = await emailAgent.sendEmail(lead.email, subject, body, senderInfo, tx, context);
          await EmailLog.create(ownerScope(owner, { to: lead.email, from: senderInfo.email, subject, body, resendId: result.messageId, campaign: type }));
          await Lead.findOneAndUpdate(ownerScope(owner, { email: lead.email }), { $set: ownerScope(owner, { ...lead, source: 'email', lastInteraction: new Date() }) }, { upsert: true });
          sent++;
          await new Promise((r) => setTimeout(r, 2000)); // 2s gap
        } catch (e) {
          failed++;
          console.error(`Email failed for ${lead.email}:`, e.message);
        }
      }
      console.log(` Email campaign done  sent: ${sent}, failed: ${failed}`);
    })();
  });


  //  Email logs 
  app.get('/api/email/logs', async (req, res) => {
    const owner = ownerFromReq(req);
    const logs = await EmailLog.find(ownerScope(owner)).sort({ sentAt: -1 }).limit(200).lean();
    res.json(logs);
  });

  //  All leads (shared with WhatsApp agent) 
  app.get('/api/leads', async (req, res) => {
    const owner = ownerFromReq(req);
    const leads = await Lead.find(ownerScope(owner)).sort({ leadScore: -1 }).limit(200).lean();
    res.json(leads);
  });

  //  Stats 
  app.get('/api/stats', async (req, res) => {
    const owner = ownerFromReq(req);
    const [totalLeads, emailsSent, opened, replied] = await Promise.all([
      Lead.countDocuments(ownerScope(owner)),
      EmailLog.countDocuments(ownerScope(owner, { status: { $ne: 'failed' } })),
      EmailLog.countDocuments(ownerScope(owner, { status: 'opened' })),
      EmailLog.countDocuments(ownerScope(owner, { status: 'replied' })),
    ]);
    res.json({ agent: AGENT_NAME, totalLeads, emailsSent, opened, replied,
      openRate: emailsSent ? ((opened/emailsSent)*100).toFixed(1)+'%' : '0%',
      replyRate: emailsSent ? ((replied/emailsSent)*100).toFixed(1)+'%' : '0%',
    });
  });

  //  Cron: Day 3 follow-up @ 10 AM 
  cron.schedule('0 10 * * *', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    const fourDaysAgo  = new Date(Date.now() - 4 * 86_400_000);

    // Leads who got cold email 3 days ago but never replied
    const context = await resolveOwnerContext(PRIMARY_OWNER);
    const leads = await Lead.find({
      ...ownerScope(PRIMARY_OWNER),
      emailOptOut:     { $ne: true },
      lastInteraction: { $gte: fourDaysAgo, $lte: threeDaysAgo },
      status:          'contacted',
    }).lean();

    console.log(` Day-3 follow-up: ${leads.length} leads`);
    for (const lead of leads) {
      try {
        const { subject, body } = await emailAgent.writeEmail(lead, 'followup_day3', {}, context);
        await emailAgent.sendEmail(lead.email, subject, body, {}, null, context);
        await Lead.updateOne(ownerScope(PRIMARY_OWNER, { _id: lead._id }), { $set: { lastInteraction: new Date() } });
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) { console.error(`Follow-up failed ${lead.email}:`, e.message); }
    }
  });

  //  Cron: Day 7 breakup email @ 11 AM 
  cron.schedule('0 11 * * *', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);

    const context = await resolveOwnerContext(PRIMARY_OWNER);
    const leads = await Lead.find({
      ...ownerScope(PRIMARY_OWNER),
      emailOptOut:     { $ne: true },
      lastInteraction: { $gte: eightDaysAgo, $lte: sevenDaysAgo },
      status:          'contacted',
    }).lean();

    console.log(` Day-7 breakup: ${leads.length} leads`);
    for (const lead of leads) {
      try {
        const { subject, body } = await emailAgent.writeEmail(lead, 'followup_day7', {}, context);
        await emailAgent.sendEmail(lead.email, subject, body, {}, null, context);
        await Lead.updateOne(ownerScope(PRIMARY_OWNER, { _id: lead._id }), { $set: { status: 'lost', lastInteraction: new Date() } });
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) { console.error(`Breakup email failed ${lead.email}:`, e.message); }
    }
  });

  //  Error handler 
  app.use((err, _req, res, _next) => {
    console.error('Email Agent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = parseInt(process.env.EMAIL_PORT) || 3001;
  app.listen(PORT, () => {
    console.log(`\n  ${AGENT_NAME} is LIVE on port ${PORT}`);
    console.log(`  Resend Webhook  POST https://your-domain.com/webhook/resend`);
    console.log(`  Stats           GET  http://localhost:${PORT}/api/stats`);
    console.log(`  Leads           GET  http://localhost:${PORT}/api/leads\n`);
  });
}

//  Handle inbound reply 
async function handleInboundReply(event) {
  const { from_email, from_name, subject, text } = event?.data || {};
  if (!from_email) return;

  console.log(` Reply from: ${from_email} | Subject: ${subject}`);

  const eventEmailId = event?.data?.email_id || event?.data?.emailId || '';
  const repliedTo = String(event?.data?.to_email || event?.data?.to || '').trim().toLowerCase();
  let latestLog = null;
  if (eventEmailId) {
    latestLog = await EmailLog.findOne({ resendId: eventEmailId }).lean();
  }
  if (!latestLog && repliedTo) {
    latestLog = await EmailLog.findOne({ to: from_email, from: repliedTo }).sort({ sentAt: -1 }).lean();
  }
  if (!latestLog) {
    latestLog = await EmailLog.findOne({ to: from_email }).sort({ sentAt: -1 }).lean();
  }
  const owner = (latestLog?.owner_email || PRIMARY_OWNER).toString().trim().toLowerCase();
  const context = await resolveOwnerContext(owner);

  await EmailLog.findOneAndUpdate(
    ownerScope(owner, { to: from_email, status: { $ne: 'replied' } }),
    { $set: { status: 'replied' } },
    { sort: { sentAt: -1 } }
  );

  const lead = await Lead.findOneAndUpdate(
    ownerScope(owner, { email: from_email }),
    { $set: ownerScope(owner, { name: from_name, status: 'qualified', lastInteraction: new Date() }) },
    { upsert: true, new: true }
  );

  // Generate AI reply
  lead._replyBody    = text;
  lead._replySubject = subject;
  const sender = await resolveSenderConfig(owner);
  const tx = getTransporter(sender.smtpUser, sender.smtpPass);
  const senderInfo = { name: sender.senderName, email: sender.senderEmail || sender.smtpUser || FROM_EMAIL };
  const { subject: replySubject, body: replyBody } = await emailAgent.writeEmail(lead, 'reply', senderInfo, context);

  await emailAgent.sendEmail(from_email, replySubject, replyBody, senderInfo, tx, context);
  await Conversation.create(ownerScope(owner, { leadId: from_email, channel: 'email', role: 'user', content: text, subject }));
  await Conversation.create(ownerScope(owner, { leadId: from_email, channel: 'email', role: 'assistant', content: replyBody, subject: replySubject }));
}

//  Graceful shutdown 
process.on('SIGINT', async () => {
  await mongoose.disconnect();
  console.log('\n  Email Agent stopped.');
  process.exit(0);
});

startEmailAgent().catch((e) => { console.error(' Startup failed:', e.message); process.exit(1); });
