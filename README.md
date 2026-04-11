# PayTrust — Railway Deployment

## Structure

```
paytrust/
├── backend/        ← Railway Service 1: FastAPI (OTP + frontend)
│   ├── otp_server.py
│   ├── index.html
│   ├── logo.png
│   ├── favicon.png
│   ├── loginbg.jpg
│   ├── requirements.txt
│   └── Procfile
└── ws-server/      ← Railway Service 2: WebSocket (Socket.IO)
    ├── ws-server.js
    ├── package.json
    └── Procfile
```

## Deploy to Railway

### 1. Push this repo to GitHub

```bash
git add .
git commit -m "PayTrust production build"
git push origin main
```

### 2. Deploy FastAPI backend
- railway.app → New Project → Deploy from GitHub
- Source Root Directory: `backend`
- Add env vars: `ACCOUNT_SID`, `AUTH_TOKEN`, `TWILIO_PHONE`
- Generate Domain → copy URL (e.g. `paytrust-backend.up.railway.app`)

### 3. Deploy WebSocket server
- Same project → + New Service → same GitHub repo
- Source Root Directory: `ws-server`
- Generate Domain → copy URL (e.g. `paytrust-ws.up.railway.app`)

### 4. Update index.html
Replace `YOUR-WS-SERVICE.up.railway.app` in `backend/index.html` with your actual WS domain, then push.

## Environment Variables (FastAPI service)

| Variable       | Value                    |
|----------------|--------------------------|
| ACCOUNT_SID    | Your Twilio Account SID  |
| AUTH_TOKEN     | Your Twilio Auth Token   |
| TWILIO_PHONE   | +1XXXXXXXXXX             |

## Test Users

| Name            | Mobile     | PIN  | Balance  |
|-----------------|------------|------|----------|
| Chirayu Mahajan | 9340228345 | 1167 | ₹84,250  |
| Pranav Chopade  | 9158763151 | 2611 | ₹32,780  |
| Farhan Farooqui | 9766876442 | 1234 | ₹15,400  |
| Mehul Patil     | 9876543210 | 9876 | ₹67,120  |
| Vedant Deshmukh | 9699189866 | 2805 | ₹51,900  |

## Verify Deployment

- Backend health: `https://YOUR-BACKEND.up.railway.app/health`
- WS ping: `https://YOUR-WS.up.railway.app/ping`
- Live users: `https://YOUR-WS.up.railway.app/status`
