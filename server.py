"""LearnBond optional server: Python 3.9+, standard library only (nothing to pip install).

- Serves the static app, so `python server.py` (or a Render web service) is all you need.
- Keeps secrets off the browser: the PayPal app secret and (optionally) the Gemini key live
  in environment variables only.
- Makes PayPal Payouts (student is paid, Study Kit Agent purchases) and Refunds (unearned money
  goes back) real Sandbox API calls. It is hard-wired to the Sandbox: it can never move real money.

Environment variables (all optional; anything missing falls back to simulated mode in the app):
  PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET   Sandbox REST app credentials (developer.paypal.com)
  GEMINI_API_KEY, GEMINI_MODEL             Lets visitors use the real AI without their own key
  STORE_MERCHANT_EMAIL                     Sandbox business email that receives Study Kit Agent purchases
  PORT                                     Defaults to 3000 (Render sets this for you)
"""
import base64
import json
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parent


def load_dotenv(path=ROOT / ".env"):
    """Reads KEY=VALUE lines from .env (if present). Real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()
PORT = int(os.environ.get("PORT", "3000"))
PAYPAL_API = "https://api-m.sandbox.paypal.com"  # Sandbox only, by design.
GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models"
MAX_AMOUNT = 1000  # Demo cap on any single payout/refund.

ENV = {
    "paypal_client_id": os.environ.get("PAYPAL_CLIENT_ID", ""),
    "paypal_secret": os.environ.get("PAYPAL_CLIENT_SECRET", ""),
    "gemini_key": os.environ.get("GEMINI_API_KEY", ""),
    "gemini_model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    "merchant_email": os.environ.get("STORE_MERCHANT_EMAIL", "study-store@business.example.com"),
}
PAYPAL_READY = bool(ENV["paypal_client_id"] and ENV["paypal_secret"])

STATIC_TYPES = {".html", ".css", ".js", ".png", ".svg", ".ico", ".md"}
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def money(value):
    try:
        n = round(float(value), 2)
    except (TypeError, ValueError):
        n = 0
    if not (0 < n <= MAX_AMOUNT):
        raise ApiError(400, f"Amount must be between 0.01 and {MAX_AMOUNT}.")
    return f"{n:.2f}"


def clean(value, limit):
    return re.sub(r"[\x00-\x1f]", " ", str(value or "")).strip()[:limit]


def http_json(method, url, body=None, headers=None, raw_body=None):
    """Small JSON HTTP client. Returns (status, parsed_json)."""
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read() or b"{}")
        except ValueError:
            return err.code, {}


# Simple per-IP rate limit for the API (protects the server's Gemini key and PayPal app).
_hits = {}
_hits_lock = threading.Lock()


def rate_limited(ip, limit=60):
    minute = int(time.time() // 60)
    with _hits_lock:
        key = (ip, minute)
        _hits[key] = _hits.get(key, 0) + 1
        if len(_hits) > 5000:
            for k in [k for k in _hits if k[1] != minute]:
                del _hits[k]
        return _hits[key] > limit


# ---------------- PayPal (Sandbox) ----------------

_token = {"value": "", "expires": 0}
_token_lock = threading.Lock()


def paypal_token():
    with _token_lock:
        if _token["value"] and time.time() < _token["expires"]:
            return _token["value"]
        auth = base64.b64encode(f'{ENV["paypal_client_id"]}:{ENV["paypal_secret"]}'.encode()).decode()
        status, data = http_json(
            "POST",
            f"{PAYPAL_API}/v1/oauth2/token",
            raw_body=b"grant_type=client_credentials",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        if status != 200:
            raise ApiError(502, f'PayPal auth failed: {data.get("error_description", status)}')
        _token.update(value=data["access_token"], expires=time.time() + data.get("expires_in", 3600) - 60)
        return _token["value"]


def paypal(method, path, body, request_id):
    status, data = http_json(
        method,
        f"{PAYPAL_API}{path}",
        body,
        headers={
            "Authorization": f"Bearer {paypal_token()}",
            "Content-Type": "application/json",
            "PayPal-Request-Id": request_id,
        },
    )
    if status >= 300:
        detail = (data.get("details") or [{}])[0]
        raise ApiError(502, f'PayPal: {detail.get("description") or detail.get("issue") or data.get("message") or data.get("name") or status}')
    return data


def payout(body):
    receiver = clean(body.get("receiver"), 200)
    if not EMAIL.match(receiver):
        raise ApiError(400, "Receiver must be an email address.")
    value = money(body.get("amount"))
    batch_id = f"LB-{uuid.uuid4()}"
    note = clean(body.get("note"), 900) or "Released by LearnBond after verified learning."
    data = paypal(
        "POST",
        "/v1/payments/payouts",
        {
            "sender_batch_header": {
                "sender_batch_id": batch_id,
                "email_subject": clean(body.get("subject"), 120) or "You have a payout from LearnBond",
                "email_message": note,
            },
            "items": [
                {
                    "recipient_type": "EMAIL",
                    "amount": {"value": value, "currency": "USD"},
                    "receiver": receiver,
                    "note": note,
                    "sender_item_id": clean(body.get("reference"), 60) or batch_id,
                }
            ],
        },
        batch_id,
    )
    header = data.get("batch_header", {})
    return {"batchId": header.get("payout_batch_id"), "status": header.get("batch_status", "PENDING"), "simulated": False}


def refund(body):
    capture_id = clean(body.get("captureId"), 40)
    if not re.fullmatch(r"[A-Z0-9]{8,40}", capture_id):
        raise ApiError(400, "Only real PayPal Sandbox captures can be refunded.")
    data = paypal(
        "POST",
        f"/v2/payments/captures/{capture_id}/refund",
        {
            "amount": {"value": money(body.get("amount")), "currency_code": "USD"},
            "note_to_payer": clean(body.get("note"), 255) or "Unearned LearnBond funds returned.",
        },
        f"LB-REFUND-{uuid.uuid4()}",
    )
    return {"refundId": data.get("id"), "status": data.get("status"), "simulated": False}


# ---------------- Gemini proxy ----------------


def gemini(body):
    model = body.get("model") if re.fullmatch(r"[\w.-]{1,60}", str(body.get("model") or "")) else ENV["gemini_model"]
    return http_json(
        "POST",
        f"{GEMINI_API}/{quote(model)}:generateContent",
        body.get("request") or {},
        headers={"Content-Type": "application/json", "x-goog-api-key": ENV["gemini_key"]},
    )


# ---------------- HTTP handler ----------------


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def client_ip(self):
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 200_000:
            raise ApiError(413, "Request body too large.")
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise ApiError(400, "Invalid JSON.")

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/api/config":
            return self.send_json(
                200,
                {
                    "gemini": bool(ENV["gemini_key"]),
                    "geminiModel": ENV["gemini_model"],
                    "paypalPayouts": PAYPAL_READY,
                    "paypalClientId": ENV["paypal_client_id"],
                    "merchantEmail": ENV["merchant_email"],
                    "environment": "sandbox",
                },
            )
        if route.startswith("/api/"):
            return self.send_json(404, {"error": "Unknown API route."})
        # Static files: only known file types, no dotfiles, nothing outside the project folder.
        target = (ROOT / route.lstrip("/")).resolve() if route != "/" else ROOT / "index.html"
        if (
            (ROOT not in target.parents and target != ROOT / "index.html")
            or target.suffix not in STATIC_TYPES
            or any(part.startswith(".") for part in target.relative_to(ROOT).parts)
        ):
            return self.send_json(404, {"error": "Not found"})
        return super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            if rate_limited(self.client_ip()):
                raise ApiError(429, "Too many requests. Slow down a little.")
            body = self.read_json()
            if route == "/api/gemini":
                if not ENV["gemini_key"]:
                    raise ApiError(501, "This server has no GEMINI_API_KEY.")
                status, data = gemini(body)
                return self.send_json(status, data)
            if route in ("/api/paypal/payout", "/api/paypal/refund"):
                if not PAYPAL_READY:
                    raise ApiError(501, "This server has no PayPal Sandbox credentials.")
                return self.send_json(200, payout(body) if route.endswith("payout") else refund(body))
            raise ApiError(404, "Unknown API route.")
        except ApiError as err:
            return self.send_json(err.status, {"error": str(err)})
        except Exception as err:  # noqa: BLE001 - never leak a stack trace to the browser
            print("Server error:", repr(err))
            return self.send_json(500, {"error": "Server error."})

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


mimetypes.add_type("text/javascript", ".js")

if __name__ == "__main__":
    print(f"LearnBond running on http://localhost:{PORT}")
    print(f'  Gemini via server: {"yes" if ENV["gemini_key"] else "no (visitors can add their own key in Settings)"}')
    print(f'  PayPal Sandbox payouts & refunds: {"REAL Sandbox API calls" if PAYPAL_READY else "simulated (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)"}')
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
