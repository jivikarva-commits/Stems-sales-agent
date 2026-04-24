'use strict';

const { fork } = require('child_process');
const path = require('path');

const RENDER_BASE_URL = process.env.RENDER_BASE_URL || 'https://stems-sales-agent.onrender.com';

const AGENTS = [
  { name: 'WhatsApp Agent', file: './whatsapp-agent.js', port: 3000, color: '\x1b[32m' },
  { name: 'Email Agent', file: './email-agent.js', port: 3001, color: '\x1b[34m' },
  { name: 'Call Agent', file: './call-agent.js', port: 3002, color: '\x1b[35m' },
];

function spawnAgent(agent) {
  const child = fork(path.resolve(__dirname, agent.file), [], {
    env: { ...process.env, PORT: String(agent.port) },
    silent: false,
  });

  child.on('error', (err) => {
    console.error(`${agent.color}[${agent.name}] Error: ${err.message}\x1b[0m`);
  });

  child.on('exit', (code) => {
    console.log(`${agent.color}[${agent.name}] Exited (code ${code}). Restarting in 3s...\x1b[0m`);
    setTimeout(() => spawnAgent(agent), 3000);
  });

  console.log(`${agent.color}✅ ${agent.name} → port ${agent.port}\x1b[0m`);
  return child;
}

console.log('\n\x1b[36m╔════════════════════════════════════════════╗');
console.log('║   STEMS AI SALES AGENT — AGENTS STARTING  ║');
console.log('╚════════════════════════════════════════════╝\x1b[0m\n');

const children = AGENTS.map(spawnAgent);

console.log(`\n\x1b[33m📌 WA Webhook:  POST ${RENDER_BASE_URL}/api/webhooks/whatsapp`);
console.log(`📊 Stats:       GET  ${RENDER_BASE_URL}/health`);
console.log(`🌐 Backend:     ${RENDER_BASE_URL}\x1b[0m\n`);

function shutdown() {
  console.log('\n👋 Shutting down node agents...');
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
