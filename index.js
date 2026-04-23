'use strict';
require('dotenv').config();
const { fork } = require('child_process');
const path = require('path');

const AGENTS = [
  { name: 'WhatsApp Agent', file: './agents/whatsapp-agent.js', port: 3000, color: '\x1b[32m' },
  { name: 'Email Agent',    file: './agents/email-agent.js',    port: 3001, color: '\x1b[34m' },
  { name: 'Call Agent',     file: './agents/call-agent.js',     port: 3002, color: '\x1b[35m' },
];

console.log('\n\x1b[36m╔════════════════════════════════════════════╗');
console.log('║   STEMS AI SALES AGENT — ALL SYSTEMS GO   ║');
console.log('╚════════════════════════════════════════════╝\x1b[0m\n');

AGENTS.forEach(({ name, file, port, color }) => {
  const child = fork(path.resolve(__dirname, file), [], {
    env: { ...process.env, PORT: port },
    silent: false,
  });
  child.on('error', err  => console.error(`${color}[${name}] Error: ${err.message}\x1b[0m`));
  child.on('exit',  code => {
    console.log(`${color}[${name}] Exited (code ${code}). Restarting in 3s...\x1b[0m`);
    setTimeout(() => fork(path.resolve(__dirname, file), [], { env: { ...process.env, PORT: port } }), 3000);
  });
  console.log(`${color}✅ ${name} → port ${port}\x1b[0m`);
});

console.log('\n\x1b[33m📌 WA Webhook:  POST /webhook/ycloud     (ngrok → port 3000)');
console.log('📊 Stats:       GET  http://localhost:3000/api/stats');
console.log('👥 Leads:       GET  http://localhost:3000/api/leads');
console.log('📞 Calls:       GET  http://localhost:3002/api/calls');
console.log('📧 Emails:      GET  http://localhost:3001/api/email/logs');
console.log('❤️  Health:      GET  http://localhost:3000/health');
console.log('🌐 Frontend:    http://localhost:3003\x1b[0m\n');

process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
