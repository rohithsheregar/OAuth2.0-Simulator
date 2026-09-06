"""
store.py — In-memory "database" for the OAuth2 simulation.
No external database required; all state lives in Python dicts.
"""

import secrets
import time

# ---------------------------------------------------------------------------
# Registered OAuth2 clients
# In a real system these would live in a database.
# ---------------------------------------------------------------------------
CLIENTS = {
    "client_abc123": {
        "client_id": "client_abc123",
        "client_secret": "secret_xyz789",
        "name": "Demo Web App",
        "redirect_uris": ["http://localhost:5000/callback"],
        "allowed_scopes": ["read:profile", "read:email"],
    }
}

# ---------------------------------------------------------------------------
# Simulated user accounts (username → password)
# ---------------------------------------------------------------------------
USERS = {
    "alice": {"password": "pass123", "name": "Alice Smith",  "email": "alice@example.com"},
    "bob":   {"password": "letmein", "name": "Bob Johnson",  "email": "bob@example.com"},
    "rohith":{"password": "rohith99","name": "Rohith S",     "email": "rohith@example.com"},
}

# ---------------------------------------------------------------------------
# Issued authorization codes
# Key: code string
# Value: {client_id, redirect_uri, scope, user, expires_at, used}
# ---------------------------------------------------------------------------
AUTH_CODES: dict = {}

# ---------------------------------------------------------------------------
# Issued access tokens
# Key: token string
# Value: {client_id, scope, user, expires_at}
# ---------------------------------------------------------------------------
ACCESS_TOKENS: dict = {}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
CODE_TTL    = 60      # seconds — authorization code lifetime
TOKEN_TTL   = 3600    # seconds — access token lifetime (1 hour)


def generate_code() -> str:
    """Generate a cryptographically random authorization code."""
    return secrets.token_urlsafe(24)


def generate_token() -> str:
    """Generate a cryptographically random access token."""
    return secrets.token_urlsafe(32)


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
    """Remove all expired codes and tokens (call periodically or on demand)."""
    now = time.time()
    expired_codes  = [k for k, v in AUTH_CODES.items()    if v["expires_at"] < now]
    expired_tokens = [k for k, v in ACCESS_TOKENS.items() if v["expires_at"] < now]
    for k in expired_codes:
        del AUTH_CODES[k]
    for k in expired_tokens:
        del ACCESS_TOKENS[k]


def reset_store() -> None:
    """Wipe all issued codes and tokens (used by the lab 'Reset' button)."""
    AUTH_CODES.clear()
    ACCESS_TOKENS.clear()
