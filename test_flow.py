"""
OAuth2 Authorization Code Grant - integration tests (Group 29)
Run: python -m pytest test_flow.py -v
"""
import threading
import time
import urllib.parse
import pytest
import requests

import app as flask_app
import store
import trace as tr


@pytest.fixture(scope="module")
def server():
    import socket
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    flask_app.app.config["TESTING"] = True

    t = threading.Thread(
        target=lambda: flask_app.app.run(host="127.0.0.1", port=port, use_reloader=False, threaded=True),
        daemon=True,
    )
    t.start()
    time.sleep(1.5)
    yield f"http://127.0.0.1:{port}"


@pytest.fixture(autouse=True)
def reset(server):
    tr.reset_events()
    store.reset_store()
    requests.post(f"{server}/api/trace/reset")
    callback = f"{server}/app/callback"
    if callback not in store.CLIENTS["client_abc123"]["redirect_uris"]:
        store.CLIENTS["client_abc123"]["redirect_uris"].append(callback)


def _fresh_code(base, user="alice"):
    c = list(store.CLIENTS.values())[0]
    code = store.generate_code()
    store.store_auth_code(
        code=code,
        client_id=c["client_id"],
        redirect_uri=f"{base}/app/callback",
        scope=" ".join(c["allowed_scopes"]),
        user=user,
    )
    return code, c


def test_happy_path(server):
    s = requests.Session()
    r1 = s.post(f"{server}/app/login/start", json={"provider": "google"},
                headers={"X-Lab-Mode": "1"})
    assert r1.status_code == 200
    d1 = r1.json()
    assert "authorize_url" in d1

    r2 = s.get(d1["authorize_url"], headers={"X-Lab-Mode": "1"})
    assert r2.status_code == 200

    r3 = s.post(f"{server}/login", data={"username": "alice", "password": "pass123"},
                headers={"X-Lab-Mode": "1"})
    assert r3.status_code == 200
    assert r3.json()["username"] == "alice"

    r5 = s.post(f"{server}/consent", data={"decision": "approve"},
                headers={"X-Lab-Mode": "1"})
    assert r5.status_code == 200
    callback_url = r5.json()["location"]

    r6 = s.get(callback_url, headers={"X-Lab-Mode": "1"})
    assert r6.status_code == 200
    assert r6.json()["state_ok"] is True
    assert "access_token" in r6.json()["token"]

    r9 = s.get(f"{server}/app/profile", headers={"X-Lab-Mode": "1"})
    assert r9.status_code == 200
    profile = r9.json()["profile"]
    assert profile["user"] == "alice"
    assert profile["name"] == "Alice Smith"


def test_bad_client_secret(server):
    code, c = _fresh_code(server)
    r = requests.post(f"{server}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{server}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": "WRONG",
    })
    assert r.status_code == 401
    assert r.json()["error"] == "invalid_client"


def test_expired_code(server):
    code, c = _fresh_code(server)
    store.AUTH_CODES[code]["expires_at"] = time.time() - 1
    r = requests.post(f"{server}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{server}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    })
    assert r.status_code == 400
    body = r.json()
    assert body["error"] == "invalid_grant"
    assert "expired" in body["error_description"].lower()


def test_replayed_code(server):
    code, c = _fresh_code(server)
    store.AUTH_CODES[code]["used"] = True
    r = requests.post(f"{server}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{server}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    })
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"
    assert "already used" in r.json()["error_description"].lower()


def test_evil_redirect_uri(server):
    code, c = _fresh_code(server)
    r = requests.post(f"{server}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  "http://evil.example.com/steal",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    })
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_state_mismatch(server):
    s = requests.Session()
    r1 = s.post(f"{server}/app/login/start", json={"provider": "google"},
                headers={"X-Lab-Mode": "1"})
    d1 = r1.json()
    s.get(d1["authorize_url"], headers={"X-Lab-Mode": "1"})
    s.post(f"{server}/login", data={"username": "alice", "password": "pass123"},
           headers={"X-Lab-Mode": "1"})
    r5 = s.post(f"{server}/consent", data={"decision": "approve"},
                headers={"X-Lab-Mode": "1"})
    good_loc = r5.json()["location"]

    parsed = urllib.parse.urlparse(good_loc)
    params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
    params["state"] = "TAMPERED_EVIL_STATE"
    tampered = parsed._replace(query=urllib.parse.urlencode(params)).geturl()

    r6 = s.get(tampered, headers={"X-Lab-Mode": "1"})
    assert r6.status_code == 400
    assert r6.json()["error"] == "state_mismatch"


def test_fake_token(server):
    r = requests.get(f"{server}/resource",
                     headers={"Authorization": "Bearer FAKE_TOTALLY_INVALID_TOKEN"})
    assert r.status_code == 401
    assert r.json()["error"] == "invalid_token"


def test_expired_token(server):
    tok = store.generate_token()
    c = list(store.CLIENTS.values())[0]
    store.store_access_token(
        token=tok, client_id=c["client_id"],
        scope=" ".join(c["allowed_scopes"]), user="alice",
    )
    store.ACCESS_TOKENS[tok]["expires_at"] = time.time() - 1
    r = requests.get(f"{server}/resource",
                     headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401
    body = r.json()
    assert body["error"] == "invalid_token"
    assert "expired" in body["error_description"].lower()


def test_access_denied(server):
    s = requests.Session()
    r1 = s.post(f"{server}/app/login/start", json={"provider": "google"},
                headers={"X-Lab-Mode": "1"})
    s.get(r1.json()["authorize_url"], headers={"X-Lab-Mode": "1"})
    s.post(f"{server}/login", data={"username": "bob", "password": "letmein"},
           headers={"X-Lab-Mode": "1"})
    r5 = s.post(f"{server}/consent", data={"decision": "deny"},
                headers={"X-Lab-Mode": "1"})
    assert r5.status_code == 200
    assert "access_denied" in r5.json().get("location", "")


def test_unsupported_response_type(server):
    r = requests.get(f"{server}/authorize", params={
        "response_type": "token",
        "client_id":     "client_abc123",
        "redirect_uri":  f"{server}/app/callback",
        "scope":         "read:profile",
        "state":         "xyz",
    })
    assert r.status_code == 400
    assert r.json()["error"] == "unsupported_response_type"


def test_trace_records_events(server):
    r_reset = requests.post(f"{server}/api/trace/reset")
    assert r_reset.status_code == 200

    s = requests.Session()
    r1 = s.post(f"{server}/app/login/start", json={"provider": "google"},
                headers={"X-Lab-Mode": "1", "X-Lab-Beat": "1"})
    s.get(r1.json()["authorize_url"], headers={"X-Lab-Mode": "1", "X-Lab-Beat": "2"})
    s.post(f"{server}/login", data={"username": "alice", "password": "pass123"},
           headers={"X-Lab-Mode": "1", "X-Lab-Beat": "3"})
    r5 = s.post(f"{server}/consent", data={"decision": "approve"},
                headers={"X-Lab-Mode": "1", "X-Lab-Beat": "5"})
    s.get(r5.json()["location"], headers={"X-Lab-Mode": "1", "X-Lab-Beat": "6"})
    s.get(f"{server}/app/profile", headers={"X-Lab-Mode": "1", "X-Lab-Beat": "9"})

    events = requests.get(f"{server}/api/trace?since=0").json()
    assert len(events) >= 6
    beats = {e["beat"] for e in events if e.get("beat") is not None}
    assert {1, 2, 3, 5, 6, 7, 9}.issubset(beats)
