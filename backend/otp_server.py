from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from twilio.rest import Client
import random, time, os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ACCOUNT_SID  = os.getenv("ACCOUNT_SID")
AUTH_TOKEN   = os.getenv("AUTH_TOKEN")
TWILIO_PHONE = os.getenv("TWILIO_PHONE")

# Safe init — won't crash even if credentials are missing
try:
    _twilio = Client(ACCOUNT_SID, AUTH_TOKEN)
except Exception as e:
    print(f"[Twilio] Init failed: {e}")
    _twilio = None

otp_store: dict = {}
OTP_EXPIRY = 120

class SendOTP(BaseModel):
    mobile: str

class VerifyOTP(BaseModel):
    mobile: str
    otp: str

# ── Serve static files from same folder as this script ──────────
# Your folder structure:  otp_server.py + index.html + loginbg.jpg etc.
# all sit in the SAME directory — no "static/" subfolder needed.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/health")
def health():
    return {"status": "ok", "service": "PayTrust", "twilio": _twilio is not None}

def generate_otp():
    return str(random.randint(100000, 999999))

@app.post("/send-otp")
def send_otp(data: SendOTP):
    otp = generate_otp()
    otp_store[data.mobile] = {"otp": otp, "expiry": time.time() + OTP_EXPIRY}
    if not _twilio or not TWILIO_PHONE:
        print(f"[DEV] OTP for {data.mobile}: {otp}")
        return {"status": "OTP_SENT", "_dev_otp": otp}
    try:
        _twilio.messages.create(
            body=f"Your Pay Trust OTP is {otp}",
            from_=TWILIO_PHONE,
            to="+91" + data.mobile,
        )
        return {"status": "OTP_SENT"}
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

@app.post("/verify-otp")
def verify_otp(data: VerifyOTP):
    record = otp_store.get(data.mobile)
    if not record:
        return {"status": "NO_OTP"}
    if time.time() > record["expiry"]:
        del otp_store[data.mobile]
        return {"status": "OTP_EXPIRED"}
    if record["otp"] == data.otp:
        del otp_store[data.mobile]
        return {"status": "SUCCESS"}
    return {"status": "INVALID"}

@app.get("/")
def root():
    return FileResponse(os.path.join(BASE_DIR, "index.html"), media_type="text/html")

@app.get("/{full_path:path}")
def serve_file(full_path: str):
    file_path = os.path.join(BASE_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(BASE_DIR, "index.html"), media_type="text/html")
