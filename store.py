import secrets
import time
import os


def _redirect_uris() -> list[str]:
    """Return local callback URLs plus the optional hosted callback URL."""
    uris = [
        "http://localhost:5000/app/callback",
        "http://127.0.0.1:5000/app/callback",
    ]
    public_base_url = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if public_base_url:
        uris.insert(0, f"{public_base_url}/app/callback")
    return uris

CLIENTS = {
    "client_abc123": {
        "client_id":      "client_abc123",
        "client_secret":  "secret_xyz789",
        "name":           "PhotoPrint Studio",
        "redirect_uris":  _redirect_uris(),
        "allowed_scopes": ["read:profile", "read:email"],
    }
}

USERS = {
    "alice":  {"password": "pass123",  "name": "Alice Smith",  "email": "alice@example.com"},
    "bob":    {"password": "letmein",  "name": "Bob Johnson",  "email": "bob@example.com"},
    "rohith": {"password": "rohith99", "name": "Rohith S",     "email": "rohith@example.com"},
}

AUTH_CODES:    dict = {}
ACCESS_TOKENS: dict = {}

CODE_TTL  = 60
TOKEN_TTL = 3600


def generate_code()  -> str: return secrets.token_urlsafe(24)
def generate_token() -> str: return secrets.token_urlsafe(32)


def store_auth_code(code: str, client_id: str, redirect_uri: str,
                    scope: str, user: str, ttl: int = CODE_TTL) -> None:
    AUTH_CODES[code] = {
        "client_id":    client_id,
        "redirect_uri": redirect_uri,
        "scope":        scope,
        "user":         user,
        "expires_at":   time.time() + ttl,
        "used":         False,
    }


def store_access_token(token: str, client_id: str, scope: str, user: str) -> None:
    ACCESS_TOKENS[token] = {
        "client_id":  client_id,
        "scope":      scope,
        "user":       user,
        "expires_at": time.time() + TOKEN_TTL,
    }


def purge_expired() -> None:
    now = time.time()
    for k in [k for k, v in AUTH_CODES.items()    if v["expires_at"] < now]: del AUTH_CODES[k]
    for k in [k for k, v in ACCESS_TOKENS.items() if v["expires_at"] < now]: del ACCESS_TOKENS[k]


def reset_store() -> None:
    AUTH_CODES.clear()
    ACCESS_TOKENS.clear()
