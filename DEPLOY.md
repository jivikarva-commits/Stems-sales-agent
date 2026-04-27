# Deploying Stems Sales Agent to Render

Two services + persistent disk for Baileys WhatsApp sessions.
The frontend is deployed separately on Vercel.

## Prerequisites
- A Render account (free tier OK to start, but **Starter ($7/mo) is required for the persistent disk**)
- A Vercel account (for the frontend)
- A MongoDB Atlas cluster
- An Anthropic API key

## Step 1 — Backend + WhatsApp on Render

1. Push your code to GitHub if you haven't already.
2. In Render dashboard click **New → Blueprint**.
3. Connect the `Stems-sales-agent` repo. Render will read `render.yaml` and propose:
   - `stems-sales-agent-backend` (Python web service; now embeds all agents)
   - Optional: `stems-sales-agent-wa` (legacy standalone WA service — can be deleted if using embedded agents)
4. Render will prompt you to fill in the **secret** environment variables:
   - `MONGODB_URI` and `MONGO_URL` (paste your Atlas connection string into both — agents accept either)
   - `CLAUDE_API_KEY` (required for AI replies; QR login still works without it)
   - `PRIMARY_OWNER_EMAIL`
   - `GOOGLE_CLIENT_ID` (for Sign in with Google)
   - Optional: Gmail / Vapi / YCloud secrets if you use those agents
5. Click **Apply** — both services will deploy. First build takes ~5 minutes.

After deploy:
- Backend: `https://stems-sales-agent-backend.onrender.com`
- Embedded agents run on localhost inside the backend container (no separate WA service needed).

## Step 2 — Frontend on Vercel

1. In Vercel, import the same GitHub repo, set **Root Directory** to `frontend`.
2. Set environment variables:
   - `REACT_APP_BACKEND_URL` → `https://stems-sales-agent-backend.onrender.com`
   - `REACT_APP_GOOGLE_CLIENT_ID` → your Google OAuth client ID
3. Deploy. Vercel auto-runs `npm run build` from `react-app-rewired`.

## Step 3 — Verify

```bash
# Health check (no auth required)
curl https://stems-sales-agent-backend.onrender.com/api/health
# → {"ok": true, "service": "stems-backend"}

curl https://stems-sales-agent-wa.onrender.com/health
# → {"ok": true, "agent": "Stems Sales Agent", ...}
```

Open the Vercel URL, sign in with Google, go to the WhatsApp setup step, and click **Generate QR Code**. The Python backend proxies the request to the Node service, which now runs on Render with persistent disk. Baileys auth files survive container restarts.

## Important notes about Render free/starter tiers

- The free tier **spins down after 15 minutes of inactivity**. The WA agent loses its in-memory Baileys socket when this happens — but credentials persist on disk and reconnect automatically on the next request (with a ~30s cold start). For a production demo, use **Starter ($7/mo per service)** which is always-on.
- The persistent disk only attaches to a service on the **Starter plan or higher** — the free plan does not support disks. If you stay on free, Baileys auth files wipe on every restart and users must re-scan QR each time.
- Inbound WhatsApp messages received during a cold-start window will queue at WhatsApp servers and deliver once the service wakes back up.

## Local development still works

Run `START_ALL.bat`. The frontend `.env` points to `http://localhost:8000` for backend and the Python backend points to `http://localhost:3000` for the Node WA agent. Same code, same MongoDB, just different env vars.
