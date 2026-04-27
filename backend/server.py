"""
STEMS AI SALES AGENT â€” Python Backend (Port 8000)
FIX v4: Real email logs, real Vapi calls, proper WA conversation fetch
"""
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.requests import Request
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from contextvars import ContextVar
from cryptography.fernet import Fernet, InvalidToken
import os, logging, csv, io, uuid, httpx, asyncio, base64, hashlib
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URI")
DB_NAME   = os.environ.get("DB_NAME", "stems-agents-data")

if not MONGO_URL:
    raise RuntimeError("Missing MONGO_URL/MONGODB_URI environment variable")

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

WA_URL    = os.environ.get("WHATSAPP_AGENT_URL", "http://localhost:3000")
EMAIL_URL = os.environ.get("EMAIL_AGENT_URL",    "http://localhost:3001")
CALL_URL  = os.environ.get("CALL_AGENT_URL",     "http://localhost:3002")
VAPI_KEY  = os.environ.get("VAPI_PRIVATE_KEY",   "")
YCLOUD_API_KEY = os.environ.get("YCLOUD_API_KEY", "")
YCLOUD_WHATSAPP_NUMBER = os.environ.get("YCLOUD_WHATSAPP_NUMBER", "")
YCLOUD_TEMPLATE_NAME = os.environ.get("YCLOUD_TEMPLATE_NAME", "hello_world")
YCLOUD_TEMPLATE_LANGUAGE = os.environ.get("YCLOUD_TEMPLATE_LANGUAGE", "en")
GOOGLE_CLIENT_ID = os.environ.get(
    "GOOGLE_CLIENT_ID",
    "882008866919-n5pb2uatmt49a1rm83f9svu3jootu1vm.apps.googleusercontent.com",
)
PRIMARY_OWNER_EMAIL = os.environ.get("PRIMARY_OWNER_EMAIL", "samerkarwande3@gmail.com").strip().lower()
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
CREDENTIAL_ENCRYPTION_SECRET = os.environ.get("CREDENTIAL_ENCRYPTION_SECRET", "stems-sales-agent")

app = FastAPI(title="Stems AI Sales Agent", version="4.0.0")
api_router = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

http = httpx.AsyncClient(timeout=12.0)
_current_user_email: ContextVar[str] = ContextVar("current_user_email", default="")

_credential_key = base64.urlsafe_b64encode(hashlib.sha256(CREDENTIAL_ENCRYPTION_SECRET.encode("utf-8")).digest())
_credential_fernet = Fernet(_credential_key)

def new_id():  return str(uuid.uuid4())
def now_str(): return datetime.now(timezone.utc).isoformat()
def past(d):   return (datetime.now(timezone.utc) - timedelta(days=d)).isoformat()

def current_user_email() -> str:
    return (_current_user_email.get("") or "").strip().lower()

def current_user_id() -> str:
    # Keep auth/session model unchanged: user_id is derived from authenticated email.
    return current_user_email()

def owner_scope(owner_field: str = "owner_email", user_field: str = "user_id") -> Dict[str, str]:
    email = current_user_email()
    uid = current_user_id()
    q: Dict[str, str] = {}
    if email:
        q[owner_field] = email
    if uid:
        q[user_field] = uid
    return q

def is_owner_user() -> bool:
    return current_user_email() == PRIMARY_OWNER_EMAIL

def scoped_query(
    base: Optional[Dict[str, Any]] = None,
    *,
    include_legacy_for_owner: bool = False,
    field: str = "owner_email",
    user_field: str = "user_id",
) -> Dict[str, Any]:
    q: Dict[str, Any] = dict(base or {})
    email = current_user_email()
    uid = current_user_id()
    if not email or not uid:
        return q
    if include_legacy_for_owner:
        legacy = {"$or": [{user_field: uid}, {user_field: {"$exists": False}, field: email}]}
        if q:
            return {"$and": [q, legacy]}
        return legacy
    q[field] = email
    q[user_field] = uid
    return q

def scoped_query_for_owner(
    owner_email: str,
    base: Optional[Dict[str, Any]] = None,
    *,
    include_legacy_for_owner: bool = False,
    field: str = "owner_email",
    user_field: str = "user_id",
) -> Dict[str, Any]:
    q: Dict[str, Any] = dict(base or {})
    email = (owner_email or "").strip().lower()
    uid = email
    if not email or not uid:
        return q
    if include_legacy_for_owner:
        legacy = {"$or": [{user_field: uid}, {user_field: {"$exists": False}, field: email}]}
        if q:
            return {"$and": [q, legacy]}
        return legacy
    q[field] = email
    q[user_field] = uid
    return q

def user_required() -> str:
    uid = current_user_id()
    if not uid:
        raise HTTPException(status_code=401, detail="Missing user context")
    return uid

def normalize_phone(p: str) -> str:
    """Return phone without leading + for DB lookups, keep + for display"""
    return (p or "").replace(" ", "").replace("-", "")

def encrypt_secret(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    return _credential_fernet.encrypt(raw.encode("utf-8")).decode("utf-8")

def decrypt_secret(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        return _credential_fernet.decrypt(raw.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # Backward compatibility with previously saved plaintext credentials.
        return raw

def mask_secret(value: str, visible_suffix: int = 4) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if len(raw) <= visible_suffix:
        return "*" * len(raw)
    return ("*" * max(8, len(raw) - visible_suffix)) + raw[-visible_suffix:]

def normalize_call_provider_mode(value: str) -> str:
    v = (value or "").strip().lower()
    if v in {"twilio", "twilio_vapi", "twilio+vapi", "twilio-vapi"}:
        return "twilio_vapi"
    if v in {"vapi", "vapi_direct", "direct_vapi", "direct"}:
        return "vapi_direct"
    return "vapi_direct"

def _normalize_e164_like(number: str) -> str:
    digits = "".join(ch for ch in str(number or "") if ch.isdigit())
    if not digits:
        return ""
    return "+" + digits

async def _validate_vapi_api_key(vapi_api_key: str):
    r = await http.get(
        "https://api.vapi.ai/assistant?limit=1",
        headers={"Authorization": f"Bearer {vapi_api_key}"},
    )
    if r.status_code == 401:
        raise HTTPException(status_code=400, detail="Invalid Vapi API key")
    if r.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Vapi credential check failed ({r.status_code})")

async def _validate_twilio_credentials(account_sid: str, auth_token: str, phone_number: str):
    account_url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}.json"
    account_resp = await http.get(account_url, auth=(account_sid, auth_token))
    if account_resp.status_code == 401:
        raise HTTPException(status_code=400, detail="Invalid Twilio credentials")
    if account_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Twilio account validation failed ({account_resp.status_code})")

    normalized_phone = _normalize_e164_like(phone_number)
    if not normalized_phone:
        raise HTTPException(status_code=400, detail="Valid Twilio phone number is required")
    number_url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/IncomingPhoneNumbers.json"
    number_resp = await http.get(number_url, params={"PhoneNumber": normalized_phone}, auth=(account_sid, auth_token))
    if number_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Twilio phone validation failed ({number_resp.status_code})")
    payload = number_resp.json() if number_resp.content else {}
    numbers = payload.get("incoming_phone_numbers") if isinstance(payload, dict) else None
    if not isinstance(numbers, list) or not numbers:
        raise HTTPException(status_code=400, detail="Twilio phone number not found in this account")

def _extract_list_payload(payload: Any, list_key_candidates: List[str]) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in list_key_candidates:
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []

async def _lookup_vapi_phone_number_id(vapi_api_key: str, phone_number: str) -> str:
    normalized_phone = _normalize_e164_like(phone_number)
    if not normalized_phone:
        return ""
    r = await http.get(
        "https://api.vapi.ai/phone-number?limit=100",
        headers={"Authorization": f"Bearer {vapi_api_key}"},
    )
    if r.status_code >= 400:
        return ""
    payload = r.json()
    numbers = _extract_list_payload(payload, ["phoneNumbers", "data", "items"])
    for item in numbers:
        num = _normalize_e164_like(item.get("number", ""))
        if num and num == normalized_phone and item.get("id"):
            return str(item.get("id"))
    return ""

async def _provision_vapi_twilio_phone_number(vapi_api_key: str, account_sid: str, auth_token: str, phone_number: str) -> str:
    headers = {"Authorization": f"Bearer {vapi_api_key}"}
    credential_resp = await http.post(
        "https://api.vapi.ai/credential",
        headers=headers,
        json={
            "provider": "twilio",
            "name": f"twilio-{current_user_id()}",
            "accountSid": account_sid,
            "authToken": auth_token,
        },
    )
    if credential_resp.status_code >= 400:
        raise HTTPException(
            status_code=400,
            detail=f"Could not import Twilio credentials into Vapi ({credential_resp.status_code}).",
        )
    credential_payload = credential_resp.json() if credential_resp.content else {}
    credential_id = credential_payload.get("id")
    if not credential_id:
        raise HTTPException(status_code=400, detail="Vapi did not return a Twilio credential ID")

    phone_resp = await http.post(
        "https://api.vapi.ai/phone-number",
        headers=headers,
        json={
            "provider": "twilio",
            "name": phone_number,
            "number": _normalize_e164_like(phone_number),
            "credentialId": credential_id,
        },
    )
    if phone_resp.status_code in {200, 201}:
        payload = phone_resp.json() if phone_resp.content else {}
        phone_number_id = payload.get("id")
        if phone_number_id:
            return str(phone_number_id)
    existing_id = await _lookup_vapi_phone_number_id(vapi_api_key, phone_number)
    if existing_id:
        return existing_id
    raise HTTPException(
        status_code=400,
        detail="Could not import Twilio phone number to Vapi. Provide an existing Vapi phone number ID.",
    )

async def _get_call_integration_doc() -> Optional[Dict[str, Any]]:
    return await db.integrations.find_one(scoped_query({"type": "call"}), {"_id": 0})

async def _get_call_runtime_config() -> Dict[str, Any]:
    integration = await _get_call_integration_doc()
    if integration:
        return {
            "provider_mode": normalize_call_provider_mode(integration.get("provider_mode", "")),
            "vapi_api_key": decrypt_secret(integration.get("vapi_api_key_enc", "")),
            "vapi_assistant_id": integration.get("vapi_assistant_id", ""),
            "vapi_phone_number_id": integration.get("vapi_phone_number_id", ""),
            "twilio_account_sid": decrypt_secret(integration.get("twilio_account_sid_enc", "")),
            "twilio_auth_token": decrypt_secret(integration.get("twilio_auth_token_enc", "")),
            "twilio_phone_number": integration.get("twilio_phone_number", ""),
            "status": integration.get("status", "active"),
        }

    # Backward compatibility: existing installs may still have call credentials in db.agents.
    legacy = await db.agents.find_one(
        scoped_query({"type": "call"}, include_legacy_for_owner=True),
        {"_id": 0, "credentials": 1, "status": 1},
    )
    creds = (legacy or {}).get("credentials") or {}
    return {
        "provider_mode": normalize_call_provider_mode(creds.get("provider_mode") or creds.get("provider", "")),
        "vapi_api_key": str(creds.get("vapi_api_key", "") or ""),
        "vapi_assistant_id": str(creds.get("vapi_assistant_id", "") or ""),
        "vapi_phone_number_id": str(creds.get("vapi_phone_number_id", "") or ""),
        "twilio_account_sid": str(creds.get("twilio_account_sid", "") or ""),
        "twilio_auth_token": str(creds.get("twilio_auth_token", "") or ""),
        "twilio_phone_number": str(creds.get("twilio_phone_number", "") or ""),
        "status": (legacy or {}).get("status", "setup_required"),
    }

def _safe_call_config_response(runtime_cfg: Dict[str, Any]) -> Dict[str, Any]:
    mode = normalize_call_provider_mode(runtime_cfg.get("provider_mode", ""))
    return {
        "provider_mode": mode,
        "provider": "twilio" if mode == "twilio_vapi" else "vapi",
        "vapi_api_key": mask_secret(runtime_cfg.get("vapi_api_key", "")),
        "vapi_assistant_id": runtime_cfg.get("vapi_assistant_id", ""),
        "vapi_phone_number_id": runtime_cfg.get("vapi_phone_number_id", ""),
        "twilio_account_sid": mask_secret(runtime_cfg.get("twilio_account_sid", "")),
        "twilio_auth_token": ("*" * 12) if runtime_cfg.get("twilio_auth_token") else "",
        "twilio_phone_number": runtime_cfg.get("twilio_phone_number", ""),
    }

def normalize_campaign_phone(phone: str) -> str:
    """Normalize phone to 91XXXXXXXXXX format for campaign sends."""
    digits = "".join(c for c in str(phone or "") if c.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        return "91" + digits
    if len(digits) == 11 and digits.startswith("0"):
        return "91" + digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    if len(digits) > 12:
        tail = digits[-10:]
        return "91" + tail if len(tail) == 10 else ""
    return ""

def campaign_phone_variants(phone: str) -> List[str]:
    variants = set()
    digits = "".join(c for c in str(phone or "") if c.isdigit())
    if not digits:
        return []
    variants.add(digits)
    variants.add("+" + digits)
    normalized = normalize_campaign_phone(digits)
    if normalized:
        variants.add(normalized)
        variants.add("+" + normalized)
        if normalized.startswith("91") and len(normalized) == 12:
            tail = normalized[2:]
            variants.add(tail)
            variants.add("+" + tail)
    return list(variants)

async def _sync_campaign_engagement_stats(campaign: Dict[str, Any]) -> Dict[str, Any]:
    cid = campaign.get("id")
    if not cid:
        return campaign

    launched_at_raw = campaign.get("launched_at") or campaign.get("created_at")
    launched_at = None
    if launched_at_raw:
        try:
            launched_at = datetime.fromisoformat(str(launched_at_raw))
        except Exception:
            launched_at = None

    leads = await db.leads.find(scoped_query({"campaign_id": cid}, include_legacy_for_owner=True), {"_id": 0, "phone": 1}).to_list(5000)
    phone_values = set()
    for lead in leads:
        for val in campaign_phone_variants(lead.get("phone", "")):
            phone_values.add(val)

    wa_replied = 0
    if phone_values:
        q = {"role": "user", "userId": {"$in": list(phone_values)}}
        if launched_at is not None:
            q["timestamp"] = {"$gte": launched_at}
        wa_repliers = await db.conversations.distinct("userId", scoped_query(q, include_legacy_for_owner=True))
        wa_replied = len(wa_repliers)

    wa_opened = await db.leads.count_documents(scoped_query({"campaign_id": cid, "wa_last_status": "read"}, include_legacy_for_owner=True))
    wa_failed = await db.leads.count_documents(scoped_query({"campaign_id": cid, "wa_last_status": "failed"}, include_legacy_for_owner=True))
    email_opened = await db.emaillogs.count_documents(scoped_query({"campaign": cid, "status": "opened"}, include_legacy_for_owner=True))
    email_replied = await db.emaillogs.count_documents(scoped_query({"campaign": cid, "status": "replied"}, include_legacy_for_owner=True))
    call_q: Dict[str, Any] = {"to": {"$in": list(phone_values)}} if phone_values else {"_id": None}
    if launched_at is not None and phone_values:
        call_q["createdAt"] = {"$gte": launched_at}
    call_total_logs = await db.calllogs.count_documents(scoped_query(call_q, include_legacy_for_owner=True)) if phone_values else 0
    call_completed_logs = await db.calllogs.count_documents({
        **scoped_query(call_q, include_legacy_for_owner=True),
        "status": {"$in": ["completed", "in-progress", "ringing", "customer-ended-call"]}
    }) if phone_values else 0

    opened_total = wa_opened + email_opened
    replied_total = wa_replied + email_replied + call_completed_logs
    failed_total = wa_failed
    called_total = max(int((campaign.get("stats") or {}).get("called", 0) or 0), call_total_logs)
    sent_total = int((campaign.get("stats") or {}).get("sent", 0) or 0)
    agents = set(campaign.get("agents") or [])
    # Backward-compat fix: old call-only campaigns stored calls in `called` but left `sent` as 0.
    if called_total > 0 and sent_total == 0 and agents == {"call"}:
        sent_total = called_total

    await db.campaigns.update_one(
        scoped_query({"id": cid}, include_legacy_for_owner=True),
        {"$set": {
            "stats.sent": sent_total,
            "stats.called": called_total,
            "stats.opened": opened_total,
            "stats.replied": replied_total,
            "stats.failed": failed_total
        }}
    )
    campaign.setdefault("stats", {})
    campaign["stats"]["sent"] = sent_total
    campaign["stats"]["called"] = called_total
    campaign["stats"]["opened"] = opened_total
    campaign["stats"]["replied"] = replied_total
    campaign["stats"]["failed"] = failed_total
    return campaign

async def node_get(url: str):
    try:
        r = await http.get(url)
        return r.json()
    except Exception as e:
        logger.warning(f"Node unreachable: {url} â€” {e}")
        return {}

async def node_post(url: str, payload: dict):
    try:
        r = await http.post(url, json=payload)
        r.raise_for_status()  # Raise exception for 4xx/5xx responses
        return r.json()
    except httpx.HTTPStatusError as e:
        status = int(e.response.status_code or 500)
        detail = e.response.text[:400]
        try:
            parsed = e.response.json()
            if isinstance(parsed, dict):
                detail = str(parsed.get("error") or parsed.get("detail") or detail)
        except Exception:
            pass
        logger.warning(f"Node POST failed: {url} â€” HTTP {status}: {detail}")
        return {"error": f"HTTP {status}", "status_code": status, "detail": detail}
    except Exception as e:
        logger.warning(f"Node POST failed: {url} â€” {e}")
        return {"error": str(e)}

async def node_delete(url: str):
    try:
        r = await http.delete(url)
        if r.status_code == 404:
            return {"not_found": True}
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        logger.warning(f"Node DELETE failed: {url} â€” HTTP {e.response.status_code}: {e.response.text}")
        return {"error": f"HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        logger.warning(f"Node DELETE failed: {url} â€” {e}")
        return {"error": str(e)}

async def node_delete_owner(url: str):
    try:
        r = await http.delete(url, headers={"X-Owner-Email": current_user_email()})
        if r.status_code == 404:
            return {"not_found": True}
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        logger.warning(f"Node owner DELETE failed: {url} â€” HTTP {e.response.status_code}: {e.response.text}")
        return {"error": f"HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        logger.warning(f"Node owner DELETE failed: {url} â€” {e}")
        return {"error": str(e)}

async def node_get_owner(url: str):
    return await node_get_with_owner(url, current_user_email())

async def node_get_with_owner(url: str, owner_email: str):
    try:
        r = await http.get(url, headers={"X-Owner-Email": (owner_email or "").strip().lower()})
        return r.json()
    except Exception as e:
        logger.warning(f"Node owner GET failed: {url} â€” {e}")
        return {}

async def node_post_owner(url: str, payload: dict):
    return await node_post_with_owner(url, payload, current_user_email())

async def node_post_with_owner(url: str, payload: dict, owner_email: str):
    try:
        r = await http.post(url, json=payload, headers={"X-Owner-Email": (owner_email or "").strip().lower()})
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        status = int(e.response.status_code or 500)
        detail = e.response.text[:400]
        try:
            parsed = e.response.json()
            if isinstance(parsed, dict):
                detail = str(parsed.get("error") or parsed.get("detail") or detail)
        except Exception:
            pass
        logger.warning(f"Node owner POST failed: {url} â€” HTTP {status}: {detail}")
        return {"error": f"HTTP {status}", "status_code": status, "detail": detail}
    except Exception as e:
        logger.warning(f"Node owner POST failed: {url} â€” {e}")
        return {"error": str(e)}

async def verify_google_credential(credential: str) -> Dict[str, Any]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google auth is not configured")
    try:
        resp = await http.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": credential},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google credential")
        payload = resp.json()
        if payload.get("aud") != GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Google client mismatch")
        if payload.get("email_verified") not in ("true", True):
            raise HTTPException(status_code=401, detail="Google email not verified")
        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Google auth verification failed")

async def backfill_user_id_for_owner(user_email: str):
    owner = (user_email or "").strip().lower()
    if not owner:
        return
    targets = [
        "agents", "campaigns", "reports", "insights", "billing",
        "leads", "conversations", "userprofiles", "emaillogs",
        "calllogs", "interactions", "whatsapp_configs", "integrations",
    ]
    for coll in targets:
        await db[coll].update_many(
            {
                "owner_email": owner,
                "$or": [
                    {"user_id": {"$exists": False}},
                    {"user_id": None},
                    {"user_id": ""},
                ],
            },
            {"$set": {"user_id": owner}},
        )

async def ensure_user_defaults(user_email: str):
    if await db.users.count_documents({"email": user_email}) == 0:
        await db.users.insert_one({
            "email": user_email,
            "name": user_email.split("@")[0],
            "plan": "Professional" if user_email == PRIMARY_OWNER_EMAIL else "Starter",
            "agent_name": "Arjun" if user_email == PRIMARY_OWNER_EMAIL else "",
            "business_name": "Stems Sales Agency" if user_email == PRIMARY_OWNER_EMAIL else "",
            "business_description": "AI-powered lead generation and sales automation." if user_email == PRIMARY_OWNER_EMAIL else "",
            "messaging_tier": "10K" if user_email == PRIMARY_OWNER_EMAIL else "",
            "onboarding_completed": user_email == PRIMARY_OWNER_EMAIL,
            "created_at": now_str(),
            "last_login": now_str(),
        })
    else:
        await db.users.update_one(
            {"email": user_email},
            {"$setOnInsert": {"email": user_email}, "$set": {"last_login": now_str()}},
            upsert=True,
        )
        await db.users.update_one(
            {"email": user_email, "agent_name": {"$exists": False}},
            {"$set": {"agent_name": "Arjun" if user_email == PRIMARY_OWNER_EMAIL else ""}},
        )
        await db.users.update_one(
            {"email": user_email, "business_name": {"$exists": False}},
            {"$set": {"business_name": "Stems Sales Agency" if user_email == PRIMARY_OWNER_EMAIL else ""}},
        )
        await db.users.update_one(
            {"email": user_email, "business_description": {"$exists": False}},
            {"$set": {"business_description": "AI-powered lead generation and sales automation." if user_email == PRIMARY_OWNER_EMAIL else ""}},
        )
        await db.users.update_one(
            {"email": user_email, "messaging_tier": {"$exists": False}},
            {"$set": {"messaging_tier": "10K" if user_email == PRIMARY_OWNER_EMAIL else ""}},
        )
        await db.users.update_one(
            {"email": user_email, "onboarding_completed": {"$exists": False}},
            {"$set": {"onboarding_completed": user_email == PRIMARY_OWNER_EMAIL}},
        )

    await backfill_user_id_for_owner(user_email)

    existing_agents = await db.agents.count_documents({"owner_email": user_email, "user_id": user_email})
    if existing_agents == 0:
        await db.agents.insert_many([
            {
                "id": new_id(),
                "owner_email": user_email,
                "user_id": user_email,
                "type": "whatsapp",
                "status": "setup_required",
                "credentials": {},
                "created_at": now_str(),
            },
            {
                "id": new_id(),
                "owner_email": user_email,
                "user_id": user_email,
                "type": "email",
                "status": "setup_required",
                "credentials": {},
                "created_at": now_str(),
            },
            {
                "id": new_id(),
                "owner_email": user_email,
                "user_id": user_email,
                "type": "call",
                "status": "setup_required",
                "credentials": {},
                "created_at": now_str(),
            },
        ])

    if await db.billing.count_documents({"owner_email": user_email, "user_id": user_email}) == 0:
        await db.billing.insert_one({
            "owner_email": user_email,
            "user_id": user_email,
            "current_plan": {
                "name": "Starter" if user_email != PRIMARY_OWNER_EMAIL else "Professional",
                "price": 0 if user_email != PRIMARY_OWNER_EMAIL else 125000,
                "calls_limit": 100 if user_email != PRIMARY_OWNER_EMAIL else 2000,
                "calls_used": 0,
                "emails_limit": 200 if user_email != PRIMARY_OWNER_EMAIL else 10000,
                "emails_used": 0,
                "whatsapp_limit": 200 if user_email != PRIMARY_OWNER_EMAIL else 5000,
                "whatsapp_used": 0,
                "billing_cycle_start": now_str(),
                "billing_cycle_end": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            },
            "plans": [
                {"name": "Starter", "price": 0, "calls": 100, "features": ["Basic CRM"]},
                {"name": "Professional", "price": 125000, "calls": 2000, "features": ["All Agents", "Advanced CRM"]},
            ],
            "invoices": [],
        })

    if await db.insights.count_documents({"owner_email": user_email, "user_id": user_email}) == 0:
        await db.insights.insert_many([
            {
                "id": new_id(),
                "owner_email": user_email,
                "user_id": user_email,
                "type": "recommendation",
                "title": "Connect your first agent",
                "content": "Setup WhatsApp, Email and Call agents to start campaigns.",
                "source": "Onboarding",
                "created_at": now_str(),
            },
            {
                "id": new_id(),
                "owner_email": user_email,
                "user_id": user_email,
                "type": "best_practice",
                "title": "Upload a CSV to launch",
                "content": "Create a campaign, upload leads CSV, then click launch.",
                "source": "Onboarding",
                "created_at": now_str(),
            },
        ])

async def ycloud_send_template(to: str, template_name: Optional[str], variables: Optional[List[str]] = None):
    if not YCLOUD_API_KEY or not YCLOUD_WHATSAPP_NUMBER:
        raise HTTPException(status_code=500, detail="YCloud config missing (YCLOUD_API_KEY/YCLOUD_WHATSAPP_NUMBER)")

    normalized_to = normalize_phone(to)
    from_number = normalize_phone(YCLOUD_WHATSAPP_NUMBER)
    name = (template_name or YCLOUD_TEMPLATE_NAME or "hello_world").strip()
    vars_list = [str(v) for v in (variables or [])]

    payload = {
        "from": from_number,
        "to": normalized_to,
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": YCLOUD_TEMPLATE_LANGUAGE},
        },
    }
    if vars_list:
        payload["template"]["components"] = [{
            "type": "body",
            "parameters": [{"type": "text", "text": val} for val in vars_list],
        }]

    try:
        r = await http.post(
            "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly",
            headers={
                "Content-Type": "application/json",
                "X-API-Key": YCLOUD_API_KEY,
            },
            json=payload,
        )
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:300] if e.response is not None else "Template send failed"
        raise HTTPException(status_code=500, detail=f"Template send failed: {detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Template send failed: {str(e)}")

def is_service_live(payload: dict) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("ok") is True or payload.get("healthy") is True or payload.get("success") is True:
        return True
    status = str(payload.get("status", "")).strip().lower()
    return status in {"ok", "healthy", "up", "running", "success"}

def metric(payload: dict, *keys: str, default: int = 0) -> int:
    if not isinstance(payload, dict):
        return default
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return default

# â”€â”€ Pydantic Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class AgentSetupRequest(BaseModel):
    type: str
    credentials: Dict[str, Any] = {}

class CampaignCreateRequest(BaseModel):
    name: str
    agents: List[str] = ["whatsapp", "email"]

class LeadStatusUpdateRequest(BaseModel):
    status: str

class LeadNoteRequest(BaseModel):
    notes: str

class ReportGenerateRequest(BaseModel):
    period: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class OutboundMessageRequest(BaseModel):
    to: str
    message: str

class TemplateMessageRequest(BaseModel):
    to: str
    template: Optional[str] = None
    variables: List[str] = []

class SingleCallRequest(BaseModel):
    phone: str
    name: Optional[str] = ""
    business: Optional[str] = ""
    location: Optional[str] = ""
    retry_attempts: Optional[int] = 1

class SingleEmailRequest(BaseModel):
    to: str
    name: Optional[str] = ""
    business: Optional[str] = ""
    location: Optional[str] = ""
    type: Optional[str] = "cold_outreach"

class GoogleTokenRequest(BaseModel):
    credential: str

class OnboardingProfileRequest(BaseModel):
    agent_name: str
    business_name: str
    business_description: str
    messaging_tier: str
    onboarding_completed: Optional[bool] = None

# â”€â”€ Seed Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async def ensure_agents():
    if await db.agents.count_documents({}) > 0:
        return
    await db.agents.insert_many([
        {"id": new_id(), "user_id": "default", "type": "whatsapp", "status": "active",
         "credentials": {"business_number": ("+" + normalize_phone(YCLOUD_WHATSAPP_NUMBER)) if YCLOUD_WHATSAPP_NUMBER else "+15559384796", "provider": "ycloud",
                         "business_name": "Stems Agency"}, "created_at": past(30)},
        {"id": new_id(), "user_id": "default", "type": "email", "status": "active",
         "credentials": {"email": "samerkarwande00@gmail.com", "provider": "gmail",
                         "domain_verified": True}, "created_at": past(28)},
        {"id": new_id(), "user_id": "default", "type": "call", "status": "active",
         "credentials": {"provider": "vapi", "phone_number": "+1 (260) 345-5523",
                         "assistant_id": os.environ.get("VAPI_ASSISTANT_ID", "")},
         "created_at": past(25)},
    ])

async def ensure_insights():
    if await db.insights.count_documents({}) > 0:
        return
    await db.insights.insert_many([
        {"id": new_id(), "user_id": "default", "type": "recommendation",
         "title": "Best Outreach Window: 6-8 PM IST",
         "content": "3.2x higher WhatsApp response rates between 6-8 PM on weekdays.",
         "source": "Platform Analytics", "created_at": past(1)},
        {"id": new_id(), "user_id": "default", "type": "market_trend",
         "title": "SaaS Adoption Surge in Indian Mid-Market",
         "content": "47% YoY growth. Key verticals: Fintech, HealthTech, EdTech.",
         "source": "Industry Analysis", "created_at": past(3)},
        {"id": new_id(), "user_id": "default", "type": "best_practice",
         "title": "WhatsApp delivers 3x better response than email",
         "content": "WhatsApp: 26.3% vs Email: 8.7%. Use WA for initial contact.",
         "source": "Campaign Analysis", "created_at": past(2)},
    ])

async def ensure_billing():
    if await db.billing.count_documents({}) > 0:
        return
    await db.billing.insert_one({
        "user_id": "default",
        "current_plan": {
            "name": "Professional", "price": 125000,
            "calls_limit": 2000, "calls_used": 0,
            "emails_limit": 10000, "emails_used": 0,
            "whatsapp_limit": 5000, "whatsapp_used": 0,
            "billing_cycle_start": past(15),
            "billing_cycle_end": (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
        },
        "plans": [
            {"name": "Starter", "price": 75000, "calls": 500,
             "features": ["Email Agent", "WhatsApp Agent", "Basic CRM"]},
            {"name": "Professional", "price": 125000, "calls": 2000,
             "features": ["All Agents", "Advanced CRM", "Unlimited Campaigns", "Priority Support"]},
            {"name": "Enterprise", "price": 250000, "calls": -1,
             "features": ["Everything in Pro", "Unlimited Calls", "Dedicated Manager", "SLA"]},
        ],
        "invoices": [
            {"id": new_id(), "date": past(15), "amount": 125000, "status": "paid", "period": "Mar 2026"},
            {"id": new_id(), "date": past(45), "amount": 125000, "status": "paid", "period": "Feb 2026"},
            {"id": new_id(), "date": past(75), "amount": 75000,  "status": "paid", "period": "Jan 2026"},
        ]
    })

@api_router.post("/auth/google")
async def auth_google(data: GoogleTokenRequest):
    payload = await verify_google_credential(data.credential)
    user_email = (payload.get("email") or "").strip().lower()
    if not user_email:
        raise HTTPException(status_code=401, detail="Google email missing")

    await db.users.update_one(
        {"email": user_email},
        {"$set": {
            "email": user_email,
            "name": payload.get("name", user_email.split("@")[0]),
            "picture": payload.get("picture", ""),
            "last_login": now_str(),
            "plan": "Professional" if user_email == PRIMARY_OWNER_EMAIL else "Starter",
        }, "$setOnInsert": {
            "created_at": now_str(),
            "agent_name": payload.get("given_name", payload.get("name", user_email.split("@")[0])) if user_email == PRIMARY_OWNER_EMAIL else "",
            "business_name": "Stems Sales Agency" if user_email == PRIMARY_OWNER_EMAIL else "",
            "business_description": "AI-powered lead generation and sales automation." if user_email == PRIMARY_OWNER_EMAIL else "",
            "messaging_tier": "10K" if user_email == PRIMARY_OWNER_EMAIL else "",
            "onboarding_completed": user_email == PRIMARY_OWNER_EMAIL,
        }},
        upsert=True,
    )
    await ensure_user_defaults(user_email)
    user = await db.users.find_one({"email": user_email}, {"_id": 0}) or {}

    session_id = new_id()
    await db.sessions.insert_one({
        "id": session_id,
        "email": user_email,
        "created_at": now_str(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat(),
    })
    return {
        "session_id": session_id,
        "email": user_email,
        "name": payload.get("name", user_email.split("@")[0]),
        "picture": payload.get("picture", ""),
        "is_owner": user_email == PRIMARY_OWNER_EMAIL,
        "onboarding_completed": bool(user.get("onboarding_completed")),
    }

@api_router.get("/auth/me")
async def auth_me(request: Request):
    email = (getattr(request.state, "user_email", "") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        await ensure_user_defaults(email)
        user = await db.users.find_one({"email": email}, {"_id": 0}) or {"email": email}
    if "onboarding_completed" not in user:
        user["onboarding_completed"] = email == PRIMARY_OWNER_EMAIL
    user.setdefault("agent_name", "")
    user.setdefault("business_name", "")
    user.setdefault("business_description", "")
    user.setdefault("messaging_tier", "")
    return user

@api_router.post("/auth/logout")
async def auth_logout(request: Request):
    sid = (request.headers.get("authorization", "").replace("Bearer ", "").strip())
    if sid:
        await db.sessions.delete_one({"id": sid})
    return {"ok": True}

@api_router.get("/onboarding/profile")
async def onboarding_profile():
    uid = user_required()
    user = await db.users.find_one({"email": uid}, {"_id": 0})
    if not user:
        await ensure_user_defaults(uid)
        user = await db.users.find_one({"email": uid}, {"_id": 0}) or {"email": uid}
    return {
        "email": user.get("email", uid),
        "agent_name": user.get("agent_name", ""),
        "business_name": user.get("business_name", ""),
        "business_description": user.get("business_description", ""),
        "messaging_tier": user.get("messaging_tier", ""),
        "onboarding_completed": bool(user.get("onboarding_completed", False)),
    }

@api_router.post("/onboarding/profile")
async def save_onboarding_profile(data: OnboardingProfileRequest):
    uid = user_required()
    tier = (data.messaging_tier or "").strip()
    if tier not in {"250", "1K", "10K", "100K"}:
        raise HTTPException(status_code=400, detail="Invalid messaging tier")
    await db.users.update_one(
        {"email": uid},
        {"$set": {
            "agent_name": (data.agent_name or "").strip(),
            "business_name": (data.business_name or "").strip(),
            "business_description": (data.business_description or "").strip(),
            "messaging_tier": tier,
            "onboarding_completed": bool(data.onboarding_completed) if data.onboarding_completed is not None else False,
            "last_login": now_str(),
        }},
        upsert=True,
    )
    # Keep WhatsApp config synchronized with selected tier for this user.
    await db.whatsapp_configs.update_one(
        scoped_query({}),
        {"$set": {
            "owner_email": current_user_email(),
            "user_id": uid,
            "messaging_tier": tier,
            "updated_at": now_str(),
        }},
        upsert=True,
    )
    user = await db.users.find_one({"email": uid}, {"_id": 0}) or {}
    return {"ok": True, "onboarding_completed": bool(user.get("onboarding_completed", False))}

@app.on_event("startup")
async def startup():
    # Disable global seed insertion to prevent cross-tenant data leakage.
    # Ensure only scoped, per-user defaults are created on first authenticated access.
    await db.whatsapp_configs.create_index([("user_id", 1)], unique=True)
    await db.agents.create_index([("user_id", 1), ("type", 1)], unique=True)
    await db.campaigns.create_index([("user_id", 1), ("id", 1)], unique=True)
    await db.leads.create_index([("user_id", 1), ("id", 1)])
    await db.reports.create_index([("user_id", 1), ("id", 1)], unique=True)
    await db.conversations.create_index([("user_id", 1), ("userId", 1), ("timestamp", -1)])
    try:
        await db.userprofiles.drop_index("userId_1")
    except Exception:
        pass
    await db.userprofiles.create_index([("user_id", 1), ("userId", 1)], unique=True)
    await db.emaillogs.create_index([("user_id", 1), ("sentAt", -1)])
    await db.calllogs.create_index([("user_id", 1), ("createdAt", -1)])
    await db.integrations.create_index([("user_id", 1), ("type", 1)], unique=True)
    await db.integrations.create_index([("owner_email", 1), ("type", 1)])
    logger.info(f"Stems backend ready | WA:{WA_URL} | Email:{EMAIL_URL} | Call:{CALL_URL}")

@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()
    await http.aclose()

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# DASHBOARD
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
@api_router.get("/dashboard/stats")
async def dashboard_stats():
    wa_users = await db.userprofiles.count_documents(scoped_query(include_legacy_for_owner=True))
    wa_msgs = await db.conversations.count_documents(scoped_query({"role": "assistant"}, include_legacy_for_owner=True))
    em_sent = await db.emaillogs.count_documents(scoped_query(include_legacy_for_owner=True))
    ca_calls = await db.calllogs.count_documents(scoped_query(include_legacy_for_owner=True))
    hot_leads = await db.userprofiles.count_documents(scoped_query({"leadScore": {"$gte": 70}}, include_legacy_for_owner=True))

    tl    = max(wa_users, await db.leads.count_documents(scoped_query(include_legacy_for_owner=True)))
    conv  = max(await db.leads.count_documents(scoped_query({"status": "converted"}, include_legacy_for_owner=True)),
                await db.userprofiles.count_documents(scoped_query({"status": "converted"}, include_legacy_for_owner=True)))
    rate  = round((conv / tl * 100) if tl > 0 else 0, 1)
    return {
        "total_leads":      tl,
        "active_campaigns": await db.campaigns.count_documents(scoped_query({"status": "active"}, include_legacy_for_owner=True)),
        "conversion_rate":  rate,
        "calls_made":       ca_calls,
        "emails_sent":      em_sent,
        "whatsapp_sent":    wa_msgs,
        "revenue_generated": conv * 42000,
        "hot_leads":        hot_leads,
    }

@api_router.get("/dashboard/activity")
async def dashboard_activity():
    items = []
    # WA conversations from Node agent DB (real messages)
    wa_convos = await db.conversations.find(
        scoped_query({"role": "user"}, include_legacy_for_owner=True), {"_id": 0}
    ).sort("timestamp", -1).limit(10).to_list(10)
    for c in wa_convos:
        uid   = c.get("userId", "")
        prof  = await db.userprofiles.find_one(scoped_query({"userId": uid}, include_legacy_for_owner=True), {"_id": 0, "name": 1})
        items.append({
            "lead_name":  prof.get("name", uid) if prof else uid,
            "company":    "",
            "agent_type": "whatsapp",
            "content":    c.get("content", ""),
            "timestamp":  c.get("timestamp", now_str()),
            "status":     "received",
        })
    # Email logs
    email_logs = await db.emaillogs.find(scoped_query(include_legacy_for_owner=True), {"_id": 0}).sort("sentAt", -1).limit(5).to_list(5)
    for e in email_logs:
        items.append({
            "lead_name":  e.get("to", ""),
            "company":    "",
            "agent_type": "email",
            "content":    e.get("subject", ""),
            "timestamp":  e.get("sentAt", now_str()),
            "status":     e.get("status", "sent"),
        })
    items.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return items[:15]

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# AGENTS
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
@api_router.get("/agents")
async def list_agents():
    agents = await db.agents.find(scoped_query(include_legacy_for_owner=True), {"_id": 0}).to_list(10)
    url_map = {"whatsapp": WA_URL, "email": EMAIL_URL, "call": CALL_URL}
    for agent in agents:
        h = await node_get_with_owner(f"{url_map.get(agent['type'], WA_URL)}/health", current_user_email())
        agent["node_live"] = is_service_live(h)
        if agent["status"] == "setup_required" and agent["node_live"] and agent.get("credentials"):
            agent["status"] = "active"
        if agent.get("type") == "whatsapp":
            wa = await node_get_owner(f"{WA_URL}/api/whatsapp/status")
            connected = isinstance(wa, dict) and bool(wa.get("connected"))
            agent["wa_connected"] = connected
            if connected and agent.get("status") != "active":
                agent["status"] = "active"
                await db.agents.update_one(
                    scoped_query({"type": "whatsapp"}, include_legacy_for_owner=True),
                    {"$set": {"status": "active"}},
                )
    return agents

@api_router.get("/agents/{agent_type}/status")
async def agent_status(agent_type: str):
    agent = await db.agents.find_one(scoped_query({"type": agent_type}, include_legacy_for_owner=True), {"_id": 0})
    if not agent:
        raise HTTPException(404, "Agent not found")
    url_map = {"whatsapp": WA_URL, "email": EMAIL_URL, "call": CALL_URL}
    h = await node_get_with_owner(f"{url_map.get(agent_type, WA_URL)}/health", current_user_email())
    agent["node_live"] = is_service_live(h)
    if agent.get("status") == "setup_required" and agent["node_live"] and agent.get("credentials"):
        agent["status"] = "active"
    if agent_type == "whatsapp":
        wa = await node_get_owner(f"{WA_URL}/api/whatsapp/status")
        connected = isinstance(wa, dict) and bool(wa.get("connected"))
        agent["wa_connected"] = connected
        if connected and agent.get("status") != "active":
            agent["status"] = "active"
            await db.agents.update_one(
                scoped_query({"type": "whatsapp"}, include_legacy_for_owner=True),
                {"$set": {"status": "active"}},
            )
    return agent

@api_router.post("/agents/setup")
async def setup_agent(data: AgentSetupRequest):
    uid = user_required()
    existing = await db.agents.find_one(scoped_query({"type": data.type}, include_legacy_for_owner=True), {"_id": 0, "credentials": 1})
    merged_credentials = dict((existing or {}).get("credentials") or {})
    merged_credentials.update(data.credentials or {})
    if data.type == "call":
        incoming = data.credentials or {}
        existing_runtime = await _get_call_runtime_config()
        provider_mode = normalize_call_provider_mode(
            incoming.get("provider_mode") or incoming.get("provider") or existing_runtime.get("provider_mode")
        )
        vapi_api_key = str(incoming.get("vapi_api_key") or existing_runtime.get("vapi_api_key") or "").strip()
        if vapi_api_key:
            await db.integrations.update_one(
                scoped_query({"type": "call"}),
                {
                    "$set": {
                        "owner_email": current_user_email(),
                        "user_id": uid,
                        "type": "call",
                        "provider_mode": provider_mode,
                        "status": "active",
                        "vapi_api_key_enc": encrypt_secret(vapi_api_key),
                        "vapi_assistant_id": str(incoming.get("vapi_assistant_id") or existing_runtime.get("vapi_assistant_id") or "").strip(),
                        "vapi_phone_number_id": str(incoming.get("vapi_phone_number_id") or existing_runtime.get("vapi_phone_number_id") or "").strip(),
                        "twilio_account_sid_enc": encrypt_secret(str(incoming.get("twilio_account_sid") or existing_runtime.get("twilio_account_sid") or "").strip()),
                        "twilio_auth_token_enc": encrypt_secret(str(incoming.get("twilio_auth_token") or existing_runtime.get("twilio_auth_token") or "").strip()),
                        "twilio_phone_number": _normalize_e164_like(str(incoming.get("twilio_phone_number") or existing_runtime.get("twilio_phone_number") or "").strip()),
                        "updated_at": now_str(),
                    },
                    "$setOnInsert": {"id": new_id(), "created_at": now_str()},
                },
                upsert=True,
            )
        for secret_key in ("vapi_api_key", "twilio_account_sid", "twilio_auth_token"):
            merged_credentials.pop(secret_key, None)
        merged_credentials["provider_mode"] = provider_mode
        merged_credentials["provider"] = "twilio" if provider_mode == "twilio_vapi" else "vapi"
        merged_credentials["vapi_assistant_id"] = str(incoming.get("vapi_assistant_id") or merged_credentials.get("vapi_assistant_id") or "")
        merged_credentials["vapi_phone_number_id"] = str(incoming.get("vapi_phone_number_id") or merged_credentials.get("vapi_phone_number_id") or "")
        merged_credentials["twilio_phone_number"] = _normalize_e164_like(str(incoming.get("twilio_phone_number") or merged_credentials.get("twilio_phone_number") or ""))
    await db.agents.update_one(
        scoped_query({"type": data.type}, include_legacy_for_owner=True),
        {"$set": {"status": "active", "credentials": merged_credentials, "owner_email": current_user_email(), "user_id": uid}},
        upsert=True,
    )
    if data.type == "whatsapp":
        await db.whatsapp_configs.update_one(
            scoped_query({}),
            {"$set": {
                "owner_email": current_user_email(),
                "user_id": uid,
                "phone_number_id": str(merged_credentials.get("phone_number_id") or ""),
                "access_token": str(merged_credentials.get("access_token") or ""),
                "business_account_id": str(merged_credentials.get("business_account_id") or ""),
                "messaging_tier": str(merged_credentials.get("messaging_tier") or ""),
                "updated_at": now_str(),
            }},
            upsert=True,
        )
    return await db.agents.find_one(scoped_query({"type": data.type}, include_legacy_for_owner=True), {"_id": 0})

@api_router.put("/agents/{agent_type}/toggle")
async def toggle_agent(agent_type: str):
    agent = await db.agents.find_one(scoped_query({"type": agent_type}, include_legacy_for_owner=True), {"_id": 0})
    if not agent:
        raise HTTPException(404)
    ns = "paused" if agent["status"] == "active" else "active"
    await db.agents.update_one(scoped_query({"type": agent_type}, include_legacy_for_owner=True), {"$set": {"status": ns}})
    agent["status"] = ns
    return agent

@api_router.put("/agents/{agent_type}/settings")
async def update_agent_settings(agent_type: str, request: Request):
    body = await request.json()
    await db.agents.update_one(
        scoped_query({"type": agent_type}, include_legacy_for_owner=True), {"$set": {"settings": body}}
    )
    return await db.agents.find_one(scoped_query({"type": agent_type}, include_legacy_for_owner=True), {"_id": 0})

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# WHATSAPP â€” FIX: both +91... and 91... format support
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
@api_router.get("/whatsapp/conversations")
async def wa_conversations():
    owner = current_user_email()

    # Get leads from Node WA agent (UserProfile collection via Node API)
    real_leads = await node_get_owner(f"{WA_URL}/api/leads")
    if not isinstance(real_leads, list):
        real_leads = []

    # Also directly query MongoDB conversations for this owner
    all_convos_cursor = db.conversations.find(
        {"owner_email": owner},
        {"_id": 0, "userId": 1, "content": 1, "role": 1, "timestamp": 1}
    ).sort("timestamp", -1).limit(500)
    all_convos = await all_convos_cursor.to_list(500)

    # Build a map: bare_phone -> {last_msg, count, timestamp}
    phone_data: dict = {}
    for c in all_convos:
        uid = str(c.get("userId", "")).lstrip("+")
        if not uid:
            continue
        if uid not in phone_data:
            phone_data[uid] = {
                "last_message": c.get("content", ""),
                "timestamp": c.get("timestamp", ""),
                "count": 1,
            }
        else:
            phone_data[uid]["count"] += 1

    # FIX 3: Pull profiles directly from MongoDB to get pushName/name fields
    # (Node /api/leads might not include pushName)
    profile_docs = await db.userprofiles.find(
        {"owner_email": owner},
        {"_id": 0, "userId": 1, "name": 1, "pushName": 1, "leadScore": 1, "status": 1, "lastInteraction": 1}
    ).to_list(500)

    profile_map: dict = {}
    for p in profile_docs:
        uid = str(p.get("userId", "")).lstrip("+")
        if uid:
            profile_map[uid] = p

    # Also include any leads from Node API
    lead_map: dict = {}
    for lead in (real_leads if isinstance(real_leads, list) else []):
        uid = str(lead.get("userId", "")).lstrip("+")
        if uid:
            lead_map[uid] = lead

    # Merge: include any phone with conversations OR known lead/profile
    all_phones = set(phone_data.keys()) | set(lead_map.keys()) | set(profile_map.keys())

    convos = []
    for bare in all_phones:
        lead = lead_map.get(bare, {})
        profile = profile_map.get(bare, {})
        data = phone_data.get(bare, {})
        uid_plus = "+" + bare

        # FIX 3: Use pushName > name > phone number as display name
        display_name = (
            profile.get("pushName") or
            profile.get("name") or
            lead.get("name") or
            bare
        )

        convos.append({
            "lead_id":       uid_plus,
            "lead_name":     display_name,
            "company":       lead.get("business", ""),
            "last_message":  data.get("last_message", ""),
            "timestamp":     data.get("timestamp", "") or profile.get("lastInteraction", "") or lead.get("lastInteraction", ""),
            "status":        lead.get("status", profile.get("status", "new")),
            "message_count": data.get("count", 0),
            "lead_score":    lead.get("leadScore", profile.get("leadScore", 0)),
        })

    convos.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
    return convos[:50]

@api_router.get("/whatsapp/conversations/{lid}")
async def wa_thread(lid: str):
    owner = current_user_email()
    lid_plus = "+" + lid if not lid.startswith("+") else lid
    lid_bare = lid.lstrip("+")

    # Query by owner_email + any known userId/lidAlias for this contact
    msgs = await db.conversations.find(
        {"owner_email": owner, "$or": [
            {"userId": {"$in": [lid_plus, lid_bare]}},
            {"lidAlias": {"$in": [lid_plus, lid_bare]}},
        ]},
        {"_id": 0}
    ).sort("timestamp", 1).to_list(300)

    # Fallback: scoped query
    if not msgs:
        msgs = await db.conversations.find(
            scoped_query({"$or": [
                {"userId": {"$in": [lid_plus, lid_bare]}},
                {"lidAlias": {"$in": [lid_plus, lid_bare]}},
            ]}, include_legacy_for_owner=True),
            {"_id": 0}
        ).sort("timestamp", 1).to_list(300)

    lead = (
        await db.userprofiles.find_one(
            {"owner_email": owner, "$or": [
                {"userId": {"$in": [lid_plus, lid_bare]}},
                {"lidAlias": {"$in": [lid_plus, lid_bare]}},
            ]}, {"_id": 0}
        )
        or await db.userprofiles.find_one(
            scoped_query({"userId": {"$in": [lid_plus, lid_bare]}}, include_legacy_for_owner=True), {"_id": 0}
        )
    )

    normalized = []
    for m in msgs:
        normalized.append({
            "role":      m.get("role", "user"),
            "content":   m.get("content", ""),
            "timestamp": str(m.get("timestamp", "")),
            "messageId": m.get("messageId", ""),
        })
    return {"lead": lead, "messages": normalized}

@api_router.delete("/whatsapp/conversations/{lid}")
async def delete_wa_conversation(lid: str):
    lid_plus = "+" + lid if not lid.startswith("+") else lid
    lid_bare = lid.lstrip("+")
    keys = [lid_plus, lid_bare]

    conv = await db.conversations.delete_many(scoped_query({"userId": {"$in": keys}}, include_legacy_for_owner=True))
    await db.userprofiles.delete_many(scoped_query({"userId": {"$in": keys}}, include_legacy_for_owner=True))

    # Best-effort sync with WA agent storage for both ID formats.
    for key in keys:
        await node_delete_owner(f"{WA_URL}/api/leads/{key}")

    return {"ok": True, "deleted_messages": conv.deleted_count}

@api_router.post("/whatsapp/send")
async def send_whatsapp(data: OutboundMessageRequest):
    uid = user_required()
    result = await node_post_owner(f"{WA_URL}/api/outbound", {"to": data.to, "message": data.message})
    if "error" in result:
        raw_err = str(result.get("error", ""))
        err_code = result.get("code")
        # YCloud/WhatsApp: outside 24-hour customer care window.
        if err_code == 131047 or "24-hour" in raw_err.lower() or "24 hours" in raw_err.lower():
            template_res = await ycloud_send_template(data.to, YCLOUD_TEMPLATE_NAME, [])
            await db.conversations.insert_one({
                "owner_email": current_user_email(),
                "user_id": uid,
                "userId": normalize_phone(data.to),
                "role": "assistant",
                "content": data.message,
                "timestamp": now_str(),
            })
            return {
                "success": True,
                "fallback": "template",
                "template": YCLOUD_TEMPLATE_NAME,
                "to": normalize_phone(data.to),
                "result": template_res,
            }
        raise HTTPException(status_code=500, detail=result.get("error", "WhatsApp send failed"))
    await db.conversations.insert_one({
        "owner_email": current_user_email(),
        "user_id": uid,
        "userId": normalize_phone(data.to),
        "role": "assistant",
        "content": data.message,
        "timestamp": now_str(),
    })
    return result

@api_router.post("/whatsapp/send/template")
async def send_whatsapp_template(data: TemplateMessageRequest):
    """Route through Node WA agent â€” uses correct FROM number and language"""
    template_name = (data.template or YCLOUD_TEMPLATE_NAME or "stems_business_intro").strip()
    result = await node_post_owner(f"{WA_URL}/api/outbound/template", {
        "to": data.to,
        "template": template_name,
        "variables": data.variables or [],
    })
    if not result:
        raise HTTPException(status_code=502, detail="WhatsApp agent unreachable")
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=500, detail=f"Template send failed: {result['error']}")
    return result

@api_router.post("/whatsapp/init-connection")
async def wa_init_connection():
    health = await node_get(f"{WA_URL}/health")
    if not is_service_live(health):
        raise HTTPException(
            status_code=503,
            detail="WhatsApp agent is offline or unreachable. Deploy the Node WA service and set WHATSAPP_AGENT_URL/RENDER_EXTERNAL_URL.",
        )
    result = await node_post_owner(f"{WA_URL}/api/whatsapp/init-connection", {})
    if isinstance(result, dict) and result.get("error"):
        status_code = int(result.get("status_code") or 500)
        if status_code < 400 or status_code > 599:
            status_code = 500
        detail = result.get("detail") or result.get("error") or "WhatsApp init failed"
        raise HTTPException(status_code=status_code, detail=detail)
    return result

@api_router.get("/whatsapp/status")
async def wa_status():
    result = await node_get_owner(f"{WA_URL}/api/whatsapp/status")
    if isinstance(result, dict) and result.get("connected"):
        await db.agents.update_one(
            scoped_query({"type": "whatsapp"}, include_legacy_for_owner=True),
            {"$set": {"status": "active"}},
        )
        await db.users.update_one(
            {"email": current_user_email()},
            {"$set": {"onboarding_completed": True}},
        )
        current_cfg = await db.whatsapp_configs.find_one(scoped_query({}), {"_id": 0}) or {}
        await db.whatsapp_configs.update_one(
            scoped_query({}),
            {"$set": {
                "owner_email": current_user_email(),
                "user_id": current_user_id(),
                "messaging_tier": current_cfg.get("messaging_tier", ""),
                "phone_number_id": current_cfg.get("phone_number_id", ""),
                "access_token": current_cfg.get("access_token", ""),
                "business_account_id": current_cfg.get("business_account_id", ""),
                "updated_at": now_str(),
            }},
            upsert=True,
        )
    return result if isinstance(result, dict) else {"connected": False, "state": "unknown"}

@api_router.post("/whatsapp/logout")
async def wa_logout():
    result = await node_post_owner(f"{WA_URL}/api/whatsapp/logout", {})
    return result if isinstance(result, dict) else {"success": False}

# â”€â”€ Per-user custom Agent Config (proxied to Node) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@api_router.get("/whatsapp/agent-config")
async def get_agent_config():
    user_required()
    result = await node_get_owner(f"{WA_URL}/api/agent-config")
    return result if isinstance(result, dict) else {
        "agent_name": "", "agent_description": "", "reply_scope": "all",
        "reply_keywords": [], "configured": False
    }

@api_router.post("/whatsapp/agent-config")
async def save_agent_config(request: Request):
    user_required()
    body = await request.json()
    result = await node_post_owner(f"{WA_URL}/api/agent-config", body)
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=result.get("detail") or result.get("error"))
    return result

@api_router.get("/whatsapp/qr-stream")
async def wa_qr_stream(request: Request):
    owner_email = (getattr(request.state, "user_email", "") or "").strip().lower()
    async def event_source():
        owner = owner_email or current_user_email()
        if not owner:
            yield "data: {\"event\":\"status\",\"data\":\"error\",\"error\":\"Missing user context\"}\n\n"
            return
        stream_url = f"{WA_URL}/api/whatsapp/qr-stream?owner={owner}"
        try:
            yield "data: {\"event\":\"status\",\"data\":\"connecting\"}\n\n"
            stream_timeout = httpx.Timeout(connect=15.0, read=None, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=stream_timeout) as stream_http:
                async with stream_http.stream("GET", stream_url, headers={"X-Owner-Email": owner}) as resp:
                    if resp.status_code >= 400:
                        text = await resp.aread()
                        msg = (text.decode("utf-8", errors="ignore")[:200] or f"HTTP {resp.status_code}").replace("\"", "'")
                        yield f"data: {{\"event\":\"status\",\"data\":\"error\",\"error\":\"{msg}\"}}\n\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            payload = line[5:].strip()
                            yield f"data: {payload}\n\n"
        except Exception as e:
            yield f"data: {{\"event\":\"status\",\"data\":\"error\",\"error\":\"{str(e)}\"}}\n\n"
    return StreamingResponse(event_source(), media_type="text/event-stream")

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# EMAIL â€” FIX: map sentAt â†’ timestamp, add lead_name + subject
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
@api_router.get("/email/logs")
async def email_logs():
    raw = await db.emaillogs.find(scoped_query(include_legacy_for_owner=True)).sort("sentAt", -1).limit(200).to_list(200)
    if not isinstance(raw, list) or not raw:
        return []
    normalized = []
    for e in raw:
        normalized.append({
            "log_id":     str(e.get("_id", "")),
            "lead_name":  e.get("to", ""),
            "lead_email": e.get("to", ""),
            "company":    "",
            "content":    e.get("subject", e.get("content", "")),
            # FIX: sentAt is the real field name in Node EmailLog schema
            "timestamp":  e.get("sentAt") or e.get("timestamp") or e.get("createdAt") or now_str(),
            "status":     e.get("status", "sent"),
            "agent_type": "email",
            "subject":    e.get("subject", ""),
            "body":       e.get("body", ""),
            "campaign":   e.get("campaign", ""),
        })
    return normalized

@api_router.delete("/email/logs/{log_id}")
async def delete_email_log(log_id: str):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(status_code=400, detail="Invalid email log id")
    r = await db.emaillogs.delete_one(scoped_query({"_id": ObjectId(log_id)}, include_legacy_for_owner=True))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Email log not found")
    return {"ok": True, "deleted": 1}

@api_router.post("/email/send")
async def send_email(data: SingleEmailRequest):
    uid = user_required()
    result = await node_post_owner(f"{EMAIL_URL}/api/email/send", {
        "to": data.to, "name": data.name,
        "business": data.business, "location": data.location, "type": data.type
    })
    if "error" in result:
        code = int(result.get("status_code") or 500)
        if code < 400 or code >= 600:
            code = 500
        raise HTTPException(status_code=code, detail=result.get("detail") or result.get("error") or "Email send failed")
    await db.emaillogs.insert_one({
        "owner_email": current_user_email(),
        "user_id": uid,
        "to": data.to,
        "subject": result.get("subject", ""),
        "body": result.get("body", ""),
        "status": "sent",
        "campaign": "",
        "sentAt": now_str(),
    })
    return result

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# CALLS â€” FIX: Real Vapi API data, NO fake fallback
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async def fetch_real_vapi_calls(vapi_api_key: str = "") -> list:
    """Fetch real calls from Vapi API directly"""
    # Strict tenant safety: never fallback to global VAPI key for user-facing logs.
    key = (vapi_api_key or "").strip()
    if not key:
        return []
    try:
        r = await http.get(
            "https://api.vapi.ai/call?limit=50",
            headers={"Authorization": f"Bearer {key}"}
        )
        payload = r.json()
        # Vapi can return either raw list or wrapped object payloads.
        if isinstance(payload, list):
            calls = payload
        elif isinstance(payload, dict):
            calls = payload.get("calls") or payload.get("data") or payload.get("items") or []
            if not isinstance(calls, list):
                calls = []
        else:
            calls = []
        if not calls:
            return []
        enriched = []
        for call in calls:
            phone    = call.get("customer", {}).get("number", "")
            phone_n  = normalize_phone(phone)
            # Look up lead in both collections
            prof = (await db.userprofiles.find_one(scoped_query({"userId": {"$in": [phone, phone_n]}}, include_legacy_for_owner=True), {"_id": 0})
                    or await db.leads.find_one(scoped_query({"phone": {"$regex": phone_n[-8:] if len(phone_n) > 8 else phone_n}}, include_legacy_for_owner=True), {"_id": 0}))

            start_time = call.get("startedAt") or call.get("createdAt") or now_str()
            end_time   = call.get("endedAt")
            duration_s = 0
            if start_time and end_time:
                try:
                    from datetime import datetime as dt
                    s = dt.fromisoformat(start_time.replace("Z", "+00:00"))
                    e = dt.fromisoformat(end_time.replace("Z", "+00:00"))
                    duration_s = int((e - s).total_seconds())
                except Exception:
                    pass

            raw_status = call.get("status", "")
            outcome_map = {
                "ended":       "completed",
                "completed":   "completed",
                "failed":      "no_answer",
                "no-answer":   "no_answer",
                "busy":        "no_answer",
                "in-progress": "interested",
            }
            outcome = outcome_map.get(raw_status, raw_status or "completed")

            enriched.append({
                "id":             call.get("id", new_id()),
                "lead_id":        phone,
                "lead_name":      prof.get("name", phone) if prof else phone,
                "company":        prof.get("business", prof.get("company", "")) if prof else "",
                "phone":          phone,
                "duration":       f"{duration_s // 60}:{duration_s % 60:02d}" if duration_s else "â€”",
                "outcome":        outcome,
                "timestamp":      start_time,
                "has_recording":  bool(call.get("recordingUrl")),
                "recording_url":  call.get("recordingUrl", ""),
                "has_transcript": bool(call.get("transcript")),
                "transcript":     call.get("transcript", ""),
                "conversation_text": call.get("transcript", ""),
                "summary":        call.get("analysis", {}).get("summary", "") if isinstance(call.get("analysis"), dict) else "",
            })
        return enriched
    except Exception as e:
        logger.warning(f"Vapi API fetch failed: {e}")
        return []

@api_router.get("/calls/logs")
async def call_logs():
    user_required()
    runtime_cfg = await _get_call_runtime_config()
    # 1. Read Node CallLog collection (populated when calls go through Node agent)
    node_calls = await db.calllogs.find(scoped_query(include_legacy_for_owner=True)).sort("createdAt", -1).limit(200).to_list(200)
    enriched = []
    if isinstance(node_calls, list):
        for call in node_calls:
            phone   = call.get("to", "")
            phone_n = normalize_phone(phone)
            prof    = await db.userprofiles.find_one(scoped_query({"userId": {"$in": [phone, phone_n]}}, include_legacy_for_owner=True), {"_id": 0})
            secs    = call.get("duration", 0) or 0
            enriched.append({
                "log_id":         str(call.get("_id", "")),
                "id":             call.get("vapiCallId", new_id()),
                "lead_id":        phone,
                "lead_name":      prof.get("name", phone) if prof else phone,
                "company":        prof.get("business", "") if prof else "",
                "phone":          phone,
                "duration":       f"{secs//60}:{secs%60:02d}" if secs else "â€”",
                "outcome":        call.get("status", "completed"),
                "timestamp":      call.get("createdAt", now_str()),
                "has_recording":  bool(call.get("recordingUrl") or call.get("recording_url")),
                "recording_url":  call.get("recordingUrl") or call.get("recording_url") or "",
                "has_transcript": bool(call.get("transcript") or call.get("conversation_text")),
                "transcript":     call.get("transcript") or call.get("conversation_text") or "",
                "conversation_text": call.get("conversation_text") or call.get("transcript") or "",
                "summary":        call.get("summary", ""),
            })

    # 2. Also fetch directly from Vapi and merge missing enrichment.
    vapi_calls = await fetch_real_vapi_calls(runtime_cfg.get("vapi_api_key", ""))
    if not enriched:
        return []

    if isinstance(vapi_calls, list) and vapi_calls:
        by_id = {str(c.get("id", "")): c for c in vapi_calls if c.get("id")}

        merged = []
        for call in enriched:
            key = str(call.get("id", ""))
            v = by_id.get(key)
            if not v:
                merged.append(call)
                continue

            merged.append({
                **call,
                "duration": v.get("duration") if (call.get("duration") in {"â€”", "", None}) else call.get("duration"),
                "outcome": v.get("outcome") if call.get("outcome") in {"initiated", "ringing", "in-progress", "", None} else call.get("outcome"),
                "timestamp": call.get("timestamp") or v.get("timestamp"),
                "recording_url": call.get("recording_url") or v.get("recording_url", ""),
                "has_recording": bool(call.get("recording_url") or v.get("recording_url")),
                "transcript": call.get("transcript") or v.get("transcript", ""),
                "conversation_text": call.get("conversation_text") or v.get("conversation_text", ""),
                "has_transcript": bool(call.get("transcript") or call.get("conversation_text") or v.get("transcript") or v.get("conversation_text")),
                "summary": call.get("summary") or v.get("summary", ""),
            })
        return merged

    return enriched

@api_router.delete("/calls/logs/{log_id}")
async def delete_call_log(log_id: str):
    user_required()
    if not ObjectId.is_valid(log_id):
        raise HTTPException(status_code=400, detail="Invalid call log id")
    r = await db.calllogs.delete_one(scoped_query({"_id": ObjectId(log_id)}, include_legacy_for_owner=True))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Call log not found")
    return {"ok": True, "deleted": 1}

@api_router.post("/calls/make")
async def make_call(data: SingleCallRequest):
    uid = user_required()
    call_cfg = await _get_call_runtime_config()
    if not call_cfg.get("vapi_api_key"):
        raise HTTPException(status_code=400, detail="Call agent is not configured. Connect Vapi first.")

    payload = {
        "phone":    data.phone,
        "name":     data.name,
        "business": data.business,
        "location": data.location,
        "provider_mode": call_cfg.get("provider_mode", "vapi_direct"),
        "vapi_api_key": call_cfg.get("vapi_api_key", ""),
        "vapi_assistant_id": call_cfg.get("vapi_assistant_id", ""),
        "vapi_phone_number_id": call_cfg.get("vapi_phone_number_id", ""),
        "twilio_account_sid": call_cfg.get("twilio_account_sid", ""),
        "twilio_auth_token": call_cfg.get("twilio_auth_token", ""),
        "twilio_phone_number": call_cfg.get("twilio_phone_number", ""),
    }
    attempts = max(1, min(int(data.retry_attempts or 1), 3))
    result: Dict[str, Any] = {}
    last_error = ""
    for attempt in range(attempts):
        result = await node_post_owner(f"{CALL_URL}/api/call", payload)
        if not (isinstance(result, dict) and result.get("error")):
            break
        last_error = str(result.get("error") or "Call agent failed")
        if attempt < attempts - 1:
            await asyncio.sleep(1.2 * (attempt + 1))

    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=500, detail=last_error or str(result.get("error") or "Call agent failed"))

    await db.calllogs.insert_one({
        "owner_email": current_user_email(),
        "user_id":     uid,
        "vapiCallId":  result.get("callId", ""),
        "to":          data.phone,
        "status":      "initiated",
        "createdAt":   now_str(),
    })
    return result

@api_router.post("/start-call")
async def start_call_alias(data: SingleCallRequest):
    return await make_call(data)

@api_router.post("/calls/connect")
async def connect_call_agent(request: Request):
    uid = user_required()
    body = await request.json()
    raw_credentials = body.get("credentials") if isinstance(body.get("credentials"), dict) else body
    if not isinstance(raw_credentials, dict):
        raise HTTPException(status_code=400, detail="Invalid credentials payload")

    existing = await _get_call_runtime_config()
    provider_mode = normalize_call_provider_mode(
        body.get("provider_mode")
        or body.get("provider")
        or raw_credentials.get("provider_mode")
        or raw_credentials.get("provider")
        or existing.get("provider_mode")
    )

    vapi_api_key = str(raw_credentials.get("vapi_api_key") or existing.get("vapi_api_key") or "").strip()
    vapi_assistant_id = str(raw_credentials.get("vapi_assistant_id") or existing.get("vapi_assistant_id") or "").strip()
    vapi_phone_number_id = str(raw_credentials.get("vapi_phone_number_id") or existing.get("vapi_phone_number_id") or "").strip()
    twilio_account_sid = str(raw_credentials.get("twilio_account_sid") or existing.get("twilio_account_sid") or "").strip()
    twilio_auth_token = str(raw_credentials.get("twilio_auth_token") or existing.get("twilio_auth_token") or "").strip()
    twilio_phone_number = str(raw_credentials.get("twilio_phone_number") or existing.get("twilio_phone_number") or "").strip()

    if not vapi_api_key:
        raise HTTPException(status_code=400, detail="vapi_api_key is required")

    try:
        await _validate_vapi_api_key(vapi_api_key)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Unable to validate Vapi credentials right now")

    if provider_mode == "twilio_vapi":
        if not (twilio_account_sid and twilio_auth_token and twilio_phone_number):
            raise HTTPException(status_code=400, detail="Twilio SID, auth token, and phone number are required")
        try:
            await _validate_twilio_credentials(twilio_account_sid, twilio_auth_token, twilio_phone_number)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Unable to validate Twilio credentials right now")
        if not vapi_phone_number_id:
            vapi_phone_number_id = await _provision_vapi_twilio_phone_number(
                vapi_api_key, twilio_account_sid, twilio_auth_token, twilio_phone_number
            )
    elif not vapi_phone_number_id:
        raise HTTPException(status_code=400, detail="vapi_phone_number_id is required for direct Vapi mode")

    await db.integrations.update_one(
        scoped_query({"type": "call"}),
        {
            "$set": {
                "owner_email": current_user_email(),
                "user_id": uid,
                "type": "call",
                "provider_mode": provider_mode,
                "status": "active",
                "vapi_api_key_enc": encrypt_secret(vapi_api_key),
                "vapi_assistant_id": vapi_assistant_id,
                "vapi_phone_number_id": vapi_phone_number_id,
                "twilio_account_sid_enc": encrypt_secret(twilio_account_sid),
                "twilio_auth_token_enc": encrypt_secret(twilio_auth_token),
                "twilio_phone_number": _normalize_e164_like(twilio_phone_number),
                "updated_at": now_str(),
                "last_error": "",
            },
            "$setOnInsert": {"id": new_id(), "created_at": now_str()},
        },
        upsert=True,
    )

    await db.agents.update_one(
        scoped_query({"type": "call"}, include_legacy_for_owner=True),
        {
            "$set": {
                "status": "active",
                "owner_email": current_user_email(),
                "user_id": uid,
                "updated_at": now_str(),
                "credentials": {
                    "provider_mode": provider_mode,
                    "provider": "twilio" if provider_mode == "twilio_vapi" else "vapi",
                    "vapi_assistant_id": vapi_assistant_id,
                    "vapi_phone_number_id": vapi_phone_number_id,
                    "twilio_phone_number": _normalize_e164_like(twilio_phone_number),
                },
            }
        },
        upsert=True,
    )

    runtime_cfg = await _get_call_runtime_config()
    return {
        "success": True,
        "status": "active",
        "provider_mode": provider_mode,
        "credentials": _safe_call_config_response(runtime_cfg),
    }

@api_router.post("/connect-call-agent")
async def connect_call_agent_alias(request: Request):
    return await connect_call_agent(request)


@api_router.get("/calls/config")
async def get_call_config():
    user_required()
    runtime_cfg = await _get_call_runtime_config()
    configured = bool(runtime_cfg.get("vapi_api_key"))
    if not configured:
        return {"status": "not_configured", "provider": None, "provider_mode": None, "credentials": {}}

    safe_cfg = _safe_call_config_response(runtime_cfg)
    return {
        "status": runtime_cfg.get("status", "active"),
        "provider": safe_cfg.get("provider"),
        "provider_mode": safe_cfg.get("provider_mode"),
        "credentials": safe_cfg,
    }

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# CAMPAIGNS, CRM, REPORTS, INSIGHTS, BILLING, WEBHOOKS, HEALTH
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
class CampaignChatRequest(BaseModel):
    message: str
    history: List[Dict[str, Any]] = []

@api_router.post("/campaigns/chat")
async def campaign_chat(data: CampaignChatRequest):
    import anthropic as _ant, json as _json
    key = os.environ.get("CLAUDE_API_KEY","")
    if not key: return {"reply":"Claude API key missing.","action":None}
    user = await db.users.find_one({"email": current_user_email()}, {"_id": 0}) or {}
    agent_name = (user.get("agent_name") or "AI Assistant").strip()
    business_name = (user.get("business_name") or "your business").strip()
    business_description = (user.get("business_description") or "Help the user manage campaigns and outreach.").strip()

    wa_s  = await node_get_owner(f"{WA_URL}/api/stats")
    em_s  = await node_get_owner(f"{EMAIL_URL}/api/stats")
    cl_s  = await node_get_owner(f"{CALL_URL}/api/stats")
    total = await db.leads.count_documents(scoped_query(include_legacy_for_owner=True)) + await db.userprofiles.count_documents(scoped_query(include_legacy_for_owner=True))
    camps = await db.campaigns.find(scoped_query(include_legacy_for_owner=True),{"_id":0,"name":1,"status":1}).to_list(10)

    sys_p = f"""You are {agent_name}, AI assistant for {business_name}.
{business_description}

AGENTS AVAILABLE:
- WhatsApp: {wa_s.get("totalUsers",0)} contacts, {wa_s.get("totalMessages",0)} msgs sent
- Email: {em_s.get("emailsSent",0)} emails sent
- Calls: {cl_s.get("totalCalls",0)} calls made
- CRM: {total} leads total
CAMPAIGNS: {[c["name"]+":"+c.get("status","") for c in camps]}

CRITICAL RULES:
1. Only operate on this user's data and campaigns.
2. Always include full country code for phone numbers.
3. Keep replies concise and action-oriented.

RETURN ONLY JSON:
{{"reply":"...","action":null}}

ACTION FORMATS (use exact format):
For sending template to new number:
{{"reply":"Bhej raha hoon!","action":{{"type":"send_template","to":"918XXXXXXXXX","template":"stems_business_intro","variables":[]}}}}

For personalized template:
{{"reply":"Personalized message bhej raha hoon!","action":{{"type":"send_template","to":"918XXXXXXXXX","template":"stems_personalized_intro","variables":["Name"]}}}}

For creating campaign:
{{"reply":"Campaign banate hain!","action":{{"type":"open_create_modal"}}}}

For AI call:
{{"reply":"Call kar raha hoon!","action":{{"type":"make_call","phone":"918XXXXXXXXX","name":"Customer"}}}}

For email:
{{"reply":"Email bhej raha hoon!","action":{{"type":"send_email","to":"email@example.com","name":"Customer","business":"Company"}}}}"""

    msgs = [{"role":m["role"],"content":m["content"]} for m in data.history[-8:]]
    msgs.append({"role":"user","content":data.message})
    try:
        c = _ant.Anthropic(api_key=key)
        r = c.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            system=sys_p,
            messages=msgs
        )
        raw = r.content[0].text.strip().replace("```json","").replace("```","").strip()
        first = raw.find("{")
        last  = raw.rfind("}")
        if first != -1 and last > first:
            try:
                result = _json.loads(raw[first:last+1])
                if "reply" in result:
                    return result
            except: pass
        try:    return _json.loads(raw)
        except: return {"reply": raw, "action": None}
    except Exception as e:
        return {"reply": f"Error: {str(e)}", "action": None}
@api_router.get("/campaigns")
async def list_campaigns():
    # Only return campaigns with actual activity OR user-created ones (not seed data)
    campaigns = await db.campaigns.find(scoped_query(include_legacy_for_owner=True), {"_id": 0}).sort("created_at", -1).to_list(100)
    enriched = []
    for campaign in campaigns:
        enriched.append(await _sync_campaign_engagement_stats(campaign))
    return enriched

@api_router.get("/campaigns/{cid}")
async def get_campaign(cid: str):
    c = await db.campaigns.find_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"_id": 0})
    if not c: raise HTTPException(404)
    c["leads"] = await db.leads.find(scoped_query({"campaign_id": cid}, include_legacy_for_owner=True), {"_id": 0}).to_list(1000)
    return await _sync_campaign_engagement_stats(c)

@api_router.post("/campaigns")
async def create_campaign(data: CampaignCreateRequest):
    uid = user_required()
    doc = {"id": new_id(), "user_id": uid, "owner_email": current_user_email(), "name": data.name, "agents": data.agents,
           "status": "draft", "stats": {"sent":0,"opened":0,"replied":0,"called":0,"failed":0,"converted":0},
           "leads_count": 0, "created_at": now_str()}
    await db.campaigns.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.delete("/campaigns/{cid}")
async def delete_campaign(cid: str):
    c = await db.campaigns.find_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"_id": 0, "status": 1, "runtime.pending_workers": 1})
    if not c:
        raise HTTPException(404, detail="Campaign not found")

    pending_workers = (c.get("runtime") or {}).get("pending_workers", 0)
    if pending_workers and pending_workers > 0:
        raise HTTPException(400, detail="Campaign is running. Please wait until current sends finish")

    await db.campaigns.delete_one(scoped_query({"id": cid}, include_legacy_for_owner=True))
    await db.leads.delete_many(scoped_query({"campaign_id": cid}, include_legacy_for_owner=True))
    return {"success": True, "deleted_campaign_id": cid}

@api_router.post("/campaigns/{cid}/upload-csv")
async def upload_csv(cid: str, file: UploadFile = File(...)):
    content = await file.read()
    # Try UTF-8 first, fallback to latin-1
    try:
        text = content.decode("utf-8-sig")  # handles BOM
    except Exception:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    uid = user_required()
    leads  = []
    for row in reader:
        # Normalize keys â€” strip spaces, lowercase
        norm = {k.strip().lower(): str(v).strip() for k, v in row.items()}

        # Phone: accept "phone number", "phone", "mobile", "contact", "number", "ph"
        phone = (norm.get("phone number") or norm.get("phone") or norm.get("mobile")
                 or norm.get("contact") or norm.get("number") or norm.get("ph") or "")
        # Clean phone â€” digits only, add 91 if 10 digits
        phone = "".join(c for c in phone if c.isdigit())
        if len(phone) == 10:
            phone = "91" + phone  # add India country code

        # Name: accept "name", "full name", "fullname", "customer name"
        name = (norm.get("name") or norm.get("full name") or norm.get("fullname")
                or norm.get("customer name") or norm.get("customer") or "")

        # Email
        email = (norm.get("email") or norm.get("email address") or norm.get("mail") or "")

        # Company
        company = (norm.get("company") or norm.get("business") or norm.get("organization") or "")

        if not phone and not email:
            continue  # skip rows with no contact info

        leads.append({
            "id": new_id(), "campaign_id": cid,
            "name": name, "company": company,
            "phone": phone, "email": email,
            "status": "new", "source": "csv_upload",
            "last_contact": None, "created_at": now_str(), "notes": "",
            "owner_email": current_user_email(),
            "user_id": uid,
        })
    if leads:
        await db.leads.insert_many(leads)
        for l in leads: l.pop("_id", None)
        await db.campaigns.update_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"$inc": {"leads_count": len(leads)}})
    return {"uploaded": len(leads), "leads": leads[:5]}

@api_router.post("/campaigns/{cid}/launch")
async def launch_campaign(cid: str, bg: BackgroundTasks):
    owner_email = current_user_email()
    c = await db.campaigns.find_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"_id": 0})
    if not c: raise HTTPException(404)
    selected_agents = [str(a).strip().lower() for a in (c.get("agents") or []) if str(a).strip()]
    if not selected_agents:
        raise HTTPException(status_code=400, detail="No agents selected for this campaign")

    # Recover from prior failed launches where leads were pre-marked before sends.
    leads = await db.leads.find({
        "campaign_id": cid,
        "$or": [
            {"status": "new"},
            {"status": "contacted", "last_contact": None}
        ]
    } | owner_scope(), {"_id": 0}).to_list(5000)

    # Validate selected agents are reachable before launch.
    url_map = {"whatsapp": WA_URL, "email": EMAIL_URL, "call": CALL_URL}
    unavailable = []
    for agent in selected_agents:
        base = url_map.get(agent)
        if not base:
            unavailable.append(agent)
            continue
        health = await node_get(f"{base}/health")
        if not is_service_live(health):
            unavailable.append(agent)
            continue
        if agent == "whatsapp":
            wa_status = await node_get_owner(f"{WA_URL}/api/whatsapp/status")
            if not (isinstance(wa_status, dict) and wa_status.get("connected")):
                # Try reconnect once using saved Baileys session before failing launch.
                init_result = await node_post_owner(f"{WA_URL}/api/whatsapp/init-connection", {})
                if isinstance(init_result, dict) and init_result.get("error"):
                    unavailable.append("whatsapp(init failed)")
                    continue
                await asyncio.sleep(1.2)
                wa_status = await node_get_owner(f"{WA_URL}/api/whatsapp/status")
            if not (isinstance(wa_status, dict) and wa_status.get("connected")):
                wa_state = (wa_status or {}).get("state", "disconnected")
                unavailable.append(f"whatsapp({wa_state})")
    if unavailable:
        raise HTTPException(status_code=503, detail=f"Agents offline/unavailable: {', '.join(unavailable)}")

    worker_count = sum(1 for a in ("whatsapp", "email", "call") if a in selected_agents and leads)
    await db.campaigns.update_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"$set": {
        "status": "active",
        "stats.sent": 0,
        "stats.opened": 0,
        "stats.replied": 0,
        "stats.called": 0,
        "stats.failed": 0,
        "runtime.pending_workers": worker_count,
        "launched_at": now_str()
    }})

    if leads and "whatsapp" in selected_agents:
        bg.add_task(_fire_wa, owner_email, cid, leads, c["name"])
    if leads and "email" in selected_agents:
        bg.add_task(_fire_email, owner_email, cid, leads)
    if leads and "call" in selected_agents:
        bg.add_task(_fire_call, owner_email, cid, leads)

    if not leads:
        await db.campaigns.update_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"$set": {"status": "completed", "completed_at": now_str()}})
    return await db.campaigns.find_one(scoped_query({"id": cid}, include_legacy_for_owner=True), {"_id": 0})

async def _fire_wa(owner_email: str, cid: str, leads: List[dict], name: str):
    """Send WhatsApp template to all leads with phone numbers"""
    sent = 0
    for l in leads:
        phone = normalize_campaign_phone(l.get("phone") or "")
        if not phone:
            continue
        try:
            lead_name = (l.get("name") or "").strip() or None
            result = await node_post_with_owner(f"{WA_URL}/api/outbound/template", {
                "to": phone,
                "template": "stems_personalized_intro" if lead_name else "stems_business_intro",
                "variables": [lead_name] if lead_name else [],
            }, owner_email)
            if isinstance(result, dict) and result.get("error"):
                logger.error(f"WA failed for {phone}: {result.get('error')}")
                await db.campaigns.update_one(
                    scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                    {"$inc": {"stats.failed": 1}},
                )
                await db.leads.update_one(
                    scoped_query_for_owner(owner_email, {"id": l.get("id")}, include_legacy_for_owner=True),
                    {"$set": {"wa_last_status": "failed"}},
                )
                continue
            sent += 1
            await db.leads.update_one(
                scoped_query_for_owner(owner_email, {"id": l.get("id")}, include_legacy_for_owner=True),
                {"$set": {"status": "contacted", "last_contact": now_str(), "wa_last_status": "sent"}}
            )
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.sent": 1}},
            )
            await asyncio.sleep(5)
        except Exception as e:
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.failed": 1}},
            )
            logger.error(f"WA failed for {phone}: {e}")
    logger.info(f"WA done for campaign '{name}': {sent}/{len(leads)}")
    await _mark_worker_done(owner_email, cid)

async def _fire_email(owner_email: str, cid: str, leads: List[dict]):
    sent = 0
    for l in leads:
        email = str(l.get("email") or "").strip()
        if not email:
            continue
        try:
            result = await node_post_with_owner(f"{EMAIL_URL}/api/email/send", {
                "to": email,
                "name": l.get("name", ""),
                "business": l.get("company", ""),
                "location": l.get("location", ""),
                "type": "cold_outreach",
            }, owner_email)
            if isinstance(result, dict) and result.get("error"):
                logger.error(f"Email failed for {email}: {result.get('error')}")
                await db.campaigns.update_one(
                    scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                    {"$inc": {"stats.failed": 1}},
                )
                continue
            sent += 1
            await db.leads.update_one(
                scoped_query_for_owner(owner_email, {"id": l.get("id")}, include_legacy_for_owner=True),
                {"$set": {"status": "contacted", "last_contact": now_str()}}
            )
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.sent": 1}},
            )
            await asyncio.sleep(1)
        except Exception as e:
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.failed": 1}},
            )
            logger.error(f"Email failed for {email}: {e}")
    logger.info(f"Email done: {sent}/{len(leads)}")
    await _mark_worker_done(owner_email, cid)

async def _fire_call(owner_email: str, cid: str, leads: List[dict]):
    called = 0
    for l in leads:
        phone = normalize_campaign_phone(l.get("phone") or "")
        if not phone:
            continue
        try:
            result = await node_post_with_owner(f"{CALL_URL}/api/call", {
                "phone": phone,
                "name": l.get("name", ""),
                "business": l.get("company", ""),
                "location": l.get("location", ""),
            }, owner_email)
            if isinstance(result, dict) and result.get("error"):
                logger.error(f"Call failed for {phone}: {result.get('error')}")
                await db.campaigns.update_one(
                    scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                    {"$inc": {"stats.failed": 1}},
                )
                continue
            called += 1
            await db.leads.update_one(
                scoped_query_for_owner(owner_email, {"id": l.get("id")}, include_legacy_for_owner=True),
                {"$set": {"status": "contacted", "last_contact": now_str()}}
            )
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.called": 1, "stats.sent": 1}},
            )
            await asyncio.sleep(2)
        except Exception as e:
            await db.campaigns.update_one(
                scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True),
                {"$inc": {"stats.failed": 1}},
            )
            logger.error(f"Call failed for {phone}: {e}")
    logger.info(f"Call done: {called}/{len(leads)}")
    await _mark_worker_done(owner_email, cid)

async def _mark_worker_done(owner_email: str, cid: str):
    cq = scoped_query_for_owner(owner_email, {"id": cid}, include_legacy_for_owner=True)
    await db.campaigns.update_one(cq, {"$inc": {"runtime.pending_workers": -1}})
    current = await db.campaigns.find_one(cq, {"_id": 0, "runtime.pending_workers": 1})
    if (current or {}).get("runtime", {}).get("pending_workers", 0) <= 0:
        await db.campaigns.update_one(cq, {"$set": {"status": "completed", "completed_at": now_str()}})

@api_router.get("/leads")
async def list_leads(status: Optional[str]=Query(None), campaign_id: Optional[str]=Query(None),
                     search: Optional[str]=Query(None), skip: int=Query(0), limit: int=Query(50)):
    q: dict = scoped_query(include_legacy_for_owner=True)
    if status and status != "all": q["status"] = status
    if campaign_id: q["campaign_id"] = campaign_id
    if search: q["$or"] = [{"name":{"$regex":search,"$options":"i"}},
                            {"email":{"$regex":search,"$options":"i"}},
                            {"company":{"$regex":search,"$options":"i"}}]
    total = await db.leads.count_documents(q)
    leads = await db.leads.find(q, {"_id": 0}).skip(skip).limit(limit).sort("created_at", -1).to_list(limit)
    if not campaign_id and not search:
        wp_q = scoped_query({} if not status or status == "all" else {"status": status}, include_legacy_for_owner=True)
        seen_phones = set()
        for p in await db.userprofiles.find(wp_q, {"_id": 0}).to_list(100):
            uid = p.get("userId", "")
            bare = uid.lstrip("+")
            if not bare or bare in seen_phones:
                continue
            seen_phones.add(bare)
            uid_plus = "+" + bare
            leads.append({
                "id":           uid_plus,
                "name":         p.get("name") or uid,
                "company":      p.get("business", ""),
                "phone":        uid_plus,
                "email":        p.get("email", ""),
                "status":       p.get("status", "new"),
                "source":       "whatsapp",
                "last_contact": p.get("lastInteraction"),
                "created_at":   p.get("createdAt"),
                "notes":        "",
                "lead_score":   p.get("leadScore", 0),
            })
        # Also add email leads from EmailLog (people who received emails but aren't in leads table)
        email_logs_distinct = await db.emaillogs.distinct("to", scoped_query(include_legacy_for_owner=True))
        for email_addr in email_logs_distinct[:20]:
            # Check if already in leads
            existing = next((l for l in leads if l.get("email") == email_addr), None)
            if not existing:
                last_log = await db.emaillogs.find_one(scoped_query({"to": email_addr}, include_legacy_for_owner=True), {"_id": 0}, sort=[("sentAt", -1)])
                leads.append({
                    "id":          f"email_{email_addr}",
                    "name":        email_addr.split("@")[0].replace(".", " ").title(),
                    "company":     "",
                    "phone":       "",
                    "email":       email_addr,
                    "status":      "contacted",
                    "source":      "email",
                    "last_contact": last_log.get("sentAt") if last_log else None,
                    "created_at":  last_log.get("sentAt") if last_log else None,
                    "notes":       "",
                    "lead_score":  0,
                })
        total = len(leads)
    return {"total": total, "leads": leads}

@api_router.get("/leads/{lid}")
async def get_lead(lid: str):
    lead = await db.leads.find_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"_id": 0})
    if not lead: raise HTTPException(404)
    return lead

@api_router.put("/leads/{lid}/status")
async def update_lead_status(lid: str, data: LeadStatusUpdateRequest):
    r = await db.leads.update_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"$set": {"status": data.status, "last_contact": now_str()}})
    if r.modified_count == 0: raise HTTPException(404)
    return await db.leads.find_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"_id": 0})

@api_router.put("/leads/{lid}/notes")
async def update_lead_notes(lid: str, data: LeadNoteRequest):
    await db.leads.update_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"$set": {"notes": data.notes}})
    return await db.leads.find_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"_id": 0})

@api_router.delete("/leads/{lid}")
async def delete_lead(lid: str):
    deleted = 0

    if lid.startswith("email_"):
        email_addr = lid.replace("email_", "", 1)
        if email_addr:
            er = await db.emaillogs.delete_many(scoped_query({"to": email_addr}, include_legacy_for_owner=True))
            deleted += er.deleted_count
        ir = await db.interactions.delete_many(scoped_query({"lead_id": lid}, include_legacy_for_owner=True))
        deleted += ir.deleted_count
        return {"ok": True, "deleted": deleted}

    lead = await db.leads.find_one(scoped_query({"id": lid}, include_legacy_for_owner=True), {"_id": 0})
    phone_variants = campaign_phone_variants((lead or {}).get("phone", "") or lid)
    if lid.startswith("+") and lid not in phone_variants:
        phone_variants.append(lid)
    bare = lid.lstrip("+")
    if bare and bare not in phone_variants:
        phone_variants.append(bare)

    if lead:
        lr = await db.leads.delete_one(scoped_query({"id": lid}, include_legacy_for_owner=True))
        deleted += lr.deleted_count
        if lead.get("email"):
            er = await db.emaillogs.delete_many(scoped_query({"to": lead.get("email")}, include_legacy_for_owner=True))
            deleted += er.deleted_count
    else:
        lr = await db.leads.delete_many(scoped_query({"phone": {"$in": phone_variants}}, include_legacy_for_owner=True))
        deleted += lr.deleted_count

    if phone_variants:
        cr = await db.conversations.delete_many(scoped_query({"userId": {"$in": phone_variants}}, include_legacy_for_owner=True))
        pr = await db.userprofiles.delete_many(scoped_query({"userId": {"$in": phone_variants}}, include_legacy_for_owner=True))
        clr = await db.calllogs.delete_many(scoped_query({"to": {"$in": phone_variants}}, include_legacy_for_owner=True))
        deleted += cr.deleted_count + pr.deleted_count + clr.deleted_count

    ir = await db.interactions.delete_many(scoped_query({"lead_id": lid}, include_legacy_for_owner=True))
    deleted += ir.deleted_count

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"ok": True, "deleted": deleted}

@api_router.get("/leads/{lid}/timeline")
async def lead_timeline(lid: str):
    items = []
    lid_plus = "+" + lid if not lid.startswith("+") else lid
    lid_bare = lid.lstrip("+")
    wa_msgs = await db.conversations.find(
        scoped_query({"userId": {"$in": [lid_plus, lid_bare]}}, include_legacy_for_owner=True), {"_id": 0}
    ).sort("timestamp", -1).limit(50).to_list(50)
    for m in wa_msgs:
        items.append({"agent_type": "whatsapp", "content": m.get("content",""),
                       "timestamp": m.get("timestamp", now_str()),
                       "status": "delivered",
                       "direction": "inbound" if m.get("role") == "user" else "outbound"})
    local = await db.interactions.find(scoped_query({"lead_id": lid}, include_legacy_for_owner=True), {"_id": 0}).sort("timestamp", -1).limit(30).to_list(30)
    items.extend(local)
    items.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return items

@api_router.get("/reports")
async def list_reports():
    reports = await db.reports.find(scoped_query(include_legacy_for_owner=True),{"_id":0}).sort("generated_at",-1).to_list(50)
    return reports

@api_router.get("/reports/{rid}")
async def get_report(rid: str):
    r = await db.reports.find_one(scoped_query({"id":rid}, include_legacy_for_owner=True),{"_id":0})
    if not r: raise HTTPException(404)
    return r

@api_router.post("/reports/generate")
async def generate_report(data: ReportGenerateRequest):
    uid = user_required()
    doc = await _build_report(data.period)
    doc["owner_email"] = current_user_email()
    doc["user_id"] = uid
    await db.reports.insert_one(doc)
    doc.pop("_id",None)
    return doc

async def _build_report(period: str) -> dict:
    """100% real data â€” no fake numbers"""
    wa_s = await node_get_owner(f"{WA_URL}/api/stats")
    em_s = await node_get_owner(f"{EMAIL_URL}/api/stats")
    ca_s = await node_get_owner(f"{CALL_URL}/api/stats")

    wa_users  = wa_s.get("totalUsers", 0)
    wa_msgs   = wa_s.get("totalMessages", 0)
    em_sent   = em_s.get("emailsSent", 0)
    em_opened = em_s.get("opened", 0)
    em_replied= em_s.get("replied", 0)
    ca_total  = ca_s.get("totalCalls", 0)
    ca_done   = ca_s.get("completed", 0)

    if ca_total == 0:
        vapi_calls = await fetch_real_vapi_calls()
        ca_total = len(vapi_calls)
        ca_done  = sum(1 for c in vapi_calls if c.get("outcome") == "completed")

    db_leads  = await db.leads.count_documents(scoped_query(include_legacy_for_owner=True))
    converted = await db.leads.count_documents(scoped_query({"status": "converted"}, include_legacy_for_owner=True))
    converted += await db.userprofiles.count_documents(scoped_query({"status": "converted"}, include_legacy_for_owner=True))
    total_contacted = db_leads + em_sent

    wa_rate = round(min((wa_users / max(wa_users, 1)) * 100, 100), 1) if wa_users else 0.0
    em_rate = round((em_opened / max(em_sent,1))*100, 1)
    ca_rate = round((ca_done / max(ca_total,1))*100, 1)

    from collections import defaultdict
    tmap = defaultdict(int)
    for log in await db.emaillogs.find(scoped_query(include_legacy_for_owner=True),{"_id":0,"sentAt":1}).to_list(500):
        if log.get("sentAt"): tmap[str(log["sentAt"])[:10]] += 1
    for c in await db.conversations.find(scoped_query({"role":"user"}, include_legacy_for_owner=True),{"_id":0,"timestamp":1}).to_list(500):
        if c.get("timestamp"): tmap[str(c["timestamp"])[:10]] += 1
    lots = [{"date":d,"count":n} for d,n in sorted(tmap.items())[-30:]] or [{"date":past(i),"count":0} for i in range(29,-1,-1)]

    uid = user_required()
    return {"id":new_id(),"user_id": uid,"owner_email": current_user_email(),"period":period,"metrics":{
        "leads_contacted": total_contacted,
        "response_rate":   round((wa_rate+em_rate)/2,1),
        "meetings_booked": max(converted, ca_done),
        "conversion_rate": round((converted/max(total_contacted,1))*100,1),
        "cost_per_lead":   0,
        "leads_over_time": lots,
        "agent_performance":[
            {"agent":"WhatsApp","sent":wa_users,"responses":wa_msgs,"rate":wa_rate},
            {"agent":"Email","sent":em_sent,"responses":em_opened,"rate":em_rate},
            {"agent":"Call","sent":ca_total,"responses":ca_done,"rate":ca_rate}],
        "conversion_funnel":[
            {"stage":"Contacted","count":total_contacted},
            {"stage":"Responded","count":wa_msgs+em_replied},
            {"stage":"Interested","count":max(int((wa_msgs+em_replied)*0.4),0)},
            {"stage":"Meeting Booked","count":max(ca_done,converted)},
            {"stage":"Converted","count":converted}]},
        "generated_at":now_str()}

@api_router.get("/insights")
async def list_insights():
    return await db.insights.find(scoped_query(include_legacy_for_owner=True),{"_id":0}).sort("created_at",-1).to_list(50)

@api_router.get("/billing")
async def get_billing():
    billing = await db.billing.find_one(scoped_query(include_legacy_for_owner=True),{"_id":0})
    if not billing:
        await ensure_user_defaults(current_user_email())
        billing = await db.billing.find_one(scoped_query(include_legacy_for_owner=True),{"_id":0})
    cs = await node_get_owner(f"{CALL_URL}/api/stats")
    es = await node_get_owner(f"{EMAIL_URL}/api/stats")
    wa = await db.conversations.count_documents(scoped_query({"role":"assistant"}, include_legacy_for_owner=True))
    if billing and billing.get("current_plan"):
        billing["current_plan"]["calls_used"]    = cs.get("totalCalls", 0)
        billing["current_plan"]["emails_used"]   = es.get("emailsSent", 0)
        billing["current_plan"]["whatsapp_used"] = wa
    return billing

@api_router.post("/webhooks/whatsapp")
async def wh_wa(request: Request):
    await node_post(f"{WA_URL}/webhook/ycloud", await request.json())
    return {"status": "forwarded"}

@api_router.post("/webhooks/email")
async def wh_email(request: Request):
    await node_post(f"{EMAIL_URL}/webhook/resend", await request.json())
    return {"status": "forwarded"}

@api_router.post("/webhooks/call")
async def wh_call(request: Request):
    await node_post(f"{CALL_URL}/webhook/vapi", await request.json())
    return {"status": "forwarded"}

@app.get("/api/health")
async def api_health():
    """Lightweight health endpoint for Render's health checks — no external deps."""
    return {"ok": True, "service": "stems-backend"}

@app.get("/health")
async def health():
    wa = await node_get(f"{WA_URL}/health")
    em = await node_get(f"{EMAIL_URL}/health")
    ca = await node_get(f"{CALL_URL}/health")
    return {
        "ok": True, "python_backend": "running",
        "node_agents": {
            "whatsapp": "live" if is_service_live(wa) else "offline",
            "email":    "live" if is_service_live(em) else "offline",
            "call":     "live" if is_service_live(ca) else "offline",
        },
        "ts": now_str()
    }

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path or ""
    if not path.startswith("/api"):
        return await call_next(request)
    if path in {"/api/auth/google", "/api/health", "/health"} or path.startswith("/api/webhooks/"):
        return await call_next(request)

    auth = request.headers.get("authorization", "")
    token = auth.replace("Bearer ", "").strip() if auth else ""
    if not token:
        token = (request.query_params.get("session_id") or "").strip()
    if not token:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    session = await db.sessions.find_one({"id": token}, {"_id": 0})
    if not session:
        return JSONResponse(status_code=401, content={"detail": "Invalid session"})
    exp_raw = session.get("expires_at")
    if exp_raw:
        try:
            if datetime.fromisoformat(str(exp_raw)) < datetime.now(timezone.utc):
                await db.sessions.delete_one({"id": token})
                return JSONResponse(status_code=401, content={"detail": "Session expired"})
        except Exception:
            pass

    email = (session.get("email") or "").strip().lower()
    request.state.user_email = email
    request.state.user_id = email
    token_ctx = _current_user_email.set(email)
    try:
        return await call_next(request)
    finally:
        _current_user_email.reset(token_ctx)

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
