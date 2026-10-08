import copy
import threading
import time

_lock    = threading.Lock()
_events: list = []
_counter = 0
MAX_EVENTS = 500

_DESCRIPTION_TO_BLOCKED = {
    "Authorization code expired":      "code.expires_at",
    "Authorization code already used": "code.used",
    "redirect_uri mismatch":           "redirect_uri allow-list",
    "Client authentication failed":    "client authentication",
    "Token not found":                 "token lookup",
    "Token expired":                   "token.expires_at",
    "State parameter mismatch":        "state check",
}

_ERROR_TO_BLOCKED = {
    "invalid_client":            "client authentication",
    "invalid_grant":             "code validation",
    "invalid_token":             "token lookup",
    "invalid_redirect_uri":      "redirect_uri allow-list",
    "state_mismatch":            "state check",
    "access_denied":             "user denied",
    "unsupported_grant_type":    "grant_type validation",
    "unsupported_response_type": "response_type validation",
    "invalid_scope":             "scope validation",
}


def blocked_by_from_resp(resp_body: dict | None, error_code: str) -> str | None:
    if isinstance(resp_body, dict):
        desc = resp_body.get("error_description", "")
        if desc in _DESCRIPTION_TO_BLOCKED:
            return _DESCRIPTION_TO_BLOCKED[desc]
    return _ERROR_TO_BLOCKED.get(error_code)


def record(*, beat, channel, from_actor, to_actor, method, url,
           req_headers, req_query, req_body,
           status, resp_headers, resp_body, blocked_by=None) -> int:
    global _counter
    with _lock:
        _counter += 1
        ev = {
            "id":      _counter,
            "ts":      time.time(),
            "beat":    beat,
            "channel": channel,
            "from":    from_actor,
            "to":      to_actor,
            "method":  method,
            "url":     url,
            "request": {
                "headers": dict(req_headers or {}),
                "query":   dict(req_query   or {}),
                "body":    req_body,
            },
            "status": status,
            "response": {
                "headers": dict(resp_headers or {}),
                "body":    resp_body,
            },
            "blocked_by": blocked_by,
        }
        _events.append(ev)
        if len(_events) > MAX_EVENTS:
            _events.pop(0)
        return _counter


def get_since(since_id: int) -> list:
    with _lock:
        return [_mask(e) for e in _events if e["id"] > since_id]


def get_all() -> list:
    with _lock:
        return [_mask(e) for e in _events]


def reset_events() -> None:
    global _events
    with _lock:
        _events = []


def _mask(ev: dict) -> dict:
    e = copy.deepcopy(ev)
    body = e["request"].get("body") or {}
    if isinstance(body, dict):
        if "client_secret" in body:
            s = str(body["client_secret"])
            body["client_secret"] = s[:4] + "****" if len(s) > 4 else "****"
        if "password" in body:
            body["password"] = "****"
    resp_body = e["response"].get("body") or {}
    if isinstance(resp_body, dict) and "access_token" in resp_body:
        t = str(resp_body["access_token"])
        resp_body["access_token"] = t[:8] + "\u2026" + t[-4:] if len(t) > 16 else t
    req_h = e["request"].get("headers") or {}
    if "Authorization" in req_h:
        v = str(req_h["Authorization"])
        if v.startswith("Bearer ") and len(v) > 15:
            req_h["Authorization"] = "Bearer " + v[7:15] + "\u2026"
    return e
