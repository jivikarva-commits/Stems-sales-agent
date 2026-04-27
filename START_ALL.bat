@echo off
title Stems AI Sales Agent - Starting All Services
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   STEMS AI SALES AGENT - ALL SYSTEMS START  ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: Kill any existing processes on these ports first
echo [0/4] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 :3001 :3002 :8000 :3003" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [1/4] Starting Node Agents (WA:3000 + Email:3001 + Call:3002)...
start "STEMS - Node Agents" cmd /k "cd /d C:\Users\dines\Documents\stems-sales-agent && node index.js"
timeout /t 5 /nobreak >nul

echo [2/4] Starting Python Backend (port 8000)...
start "STEMS - Python Backend" cmd /k "cd /d C:\Users\dines\Documents\stems-sales-agent\backend && python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 4 /nobreak >nul

echo [3/4] Starting Ngrok (tunnel to port 3000)...
start "STEMS - Ngrok" cmd /k "ngrok http 3000 --host-header=localhost"
timeout /t 3 /nobreak >nul

echo [4/4] Starting Frontend (port 3003)...
start "STEMS - Frontend" cmd /k "cd /d C:\Users\dines\Documents\stems-sales-agent\frontend && npm start"

echo.
echo  ============================================
echo  All services starting!
echo.
echo  Frontend:    http://localhost:3003
echo  Backend:     http://localhost:8000/health
echo  WA Agent:    http://localhost:3000/health
echo  Ngrok UI:    http://localhost:4040
echo.
echo  Webhook URL: Set ngrok URL + /webhook/ycloud
echo               in YCloud Dashboard
echo  ============================================
echo.
echo  NOTE: Do NOT run old ai-sales-agent or
echo        stems-ai-sales-agent projects!
echo        Only this project should run.
echo.
pause
