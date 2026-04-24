# TODO - WhatsApp Render Production Fix

- [ ] Implement MongoDB-based Baileys auth state in `agents/whatsapp-agent.js`
- [ ] Replace `useMultiFileAuthState` flow with Mongo-backed state and creds persistence
- [ ] Add detailed WhatsApp init/startup/error logs and success marker log
- [ ] Extend `agents/index.js` with subprocess health/debug telemetry endpoint
- [ ] Add backend `/api/whatsapp/debug` in `backend/server.py` with subprocess + session visibility
- [ ] Run critical-path endpoint tests for health/init/status/debug
- [ ] Commit and push to `main`
