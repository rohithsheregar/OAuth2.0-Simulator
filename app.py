import os
import time
import urllib.parse

import requests as http_client
from flask import Flask, g, jsonify, redirect, render_template, request, session

import store
import trace as tr
from client_app import bp as client_bp

app = Flask(__name__)
app.secret_key = "oauth2-lab-secret-do-not-use-in-production"
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.register_blueprint(client_bp)

_TRACED_PREFIXES = ("/authorize", "/login", "/consent", "/token", "/resource", "/app/")

_ENDPOINT_ACTORS = {
    "authorize":              ("browser", "auth",     "front"),
    "login":                  ("browser", "auth",     "front"),
    "consent":                ("browser", "auth",     "front"),
    "token":                  ("client",  "auth",     "back"),
    "resource":               ("client",  "resource", "back"),
    "client_bp.login_start":  ("browser", "client",  "front"),
    "client_bp.app_callback": ("browser", "client",  "front"),
    "client_bp.app_profile":  ("client",  "resource", "back"),
}


@app.before_request
def _capture_req():
    if not any(request.path.startswith(p) for p in _TRACED_PREFIXES):
        return
    try:
        raw = request.headers.get("X-Lab-Beat")
        g._lab_beat = int(raw) if raw is not None else None
    except (ValueError, TypeError):
        g._lab_beat = None
    if request.is_json:
        g._lab_req_body = request.get_json(silent=True, force=True) or {}
    elif request.form:
        g._lab_req_body = dict(request.form)
    else:
        g._lab_req_body = None
    g._lab_req_headers = {
        k: v for k, v in request.headers
        if k not in ("Cookie", "Host", "Content-Length")
    }
    g._lab_req_query = dict(request.args)


@app.after_request
def _record_trace(response):
    if not any(request.path.startswith(p) for p in _TRACED_PREFIXES):
        return response
    beat        = getattr(g, "_lab_beat",      None)
    req_body    = getattr(g, "_lab_req_body",   None)
    req_headers = getattr(g, "_lab_req_headers", {})
    req_query   = getattr(g, "_lab_req_query",   {})

    actor_override = request.headers.get("X-Lab-Actor")
    endpoint       = request.endpoint or ""
    from_actor, to_actor, channel = _ENDPOINT_ACTORS.get(endpoint, ("browser", "auth", "front"))
    if actor_override == "client":
        from_actor = "client"
        channel    = "back"

    status      = getattr(g, "_trace_redirect_status",   response.status_code)
    loc         = getattr(g, "_trace_redirect_location",  None)
    resp_headers = {"Location": loc} if loc else dict(response.headers)

    try:
        resp_body = response.get_json(silent=True, force=True)
    except Exception:
        resp_body = None

    blocked_by = None
    if response.status_code >= 400 and isinstance(resp_body, dict):
        err_code = resp_body.get("error", "")
        blocked_by = tr.blocked_by_from_resp(resp_body, err_code)

    tr.record(
        beat=beat,
        channel=channel,
        from_actor=from_actor,
        to_actor=to_actor,
        method=request.method,
        url=request.url,
        req_headers=req_headers,
        req_query=req_query,
        req_body=req_body,
        status=status,
        resp_headers=resp_headers,
        resp_body=resp_body,
        blocked_by=blocked_by,
    )
    return response


def _lab_redirect(location: str, status: int = 302):
    if request.headers.get("X-Lab-Mode") == "1":
        g._trace_redirect_status   = status
        g._trace_redirect_location = location
        return jsonify({"redirect_status": status, "location": location})
    return redirect(location, status)


def _err(code: str, description: str, http_status: int):
    return jsonify({"error": code, "error_description": description}), http_status


def _validate_client(client_id: str, client_secret: str):
    c = store.CLIENTS.get(client_id)
    if c and c["client_secret"] == client_secret:
        return c
    return None


def _base() -> str:
    return request.host_url.rstrip("/")


@app.route("/")
def index():
    return redirect("/lab")


@app.route("/lab")
def lab():
    return render_template("lab.html")


@app.route("/explain")
def explain():
    return render_template("explain.html")


@app.route("/authorize")
def authorize():
    client_id     = request.args.get("client_id",     "")
    redirect_uri  = request.args.get("redirect_uri",  "")
    scope         = request.args.get("scope",          "")
    state         = request.args.get("state",          "")
    response_type = request.args.get("response_type", "")

    if response_type != "code":
        return _err("unsupported_response_type", "Only 'code' response_type is supported", 400)

    client = store.CLIENTS.get(client_id)
    if not client:
        return _err("invalid_client", f"Unknown client_id: {client_id}", 400)

    if redirect_uri not in client["redirect_uris"]:
        return _err("invalid_redirect_uri", "redirect_uri not registered for this client", 400)

    requested = scope.split()
    bad = [s for s in requested if s not in client["allowed_scopes"]]
    if bad:
        return _err("invalid_scope", f"Unsupported scopes: {bad}", 400)

    session["as_oauth_params"] = {
        "client_id":   client_id,
        "redirect_uri": redirect_uri,
        "scope":        scope,
        "state":        state,
    }

    if request.headers.get("X-Lab-Mode") == "1":
        return jsonify({
            "step":        "1_authorize_validated",
            "client_name": client["name"],
            "scope":       scope,
            "state":       state,
            "redirect_uri": redirect_uri,
        })

    return render_template("login.html", client_name=client["name"], scope=scope)


@app.route("/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or request.form
    username = data.get("username", "")
    password = data.get("password", "")
    params   = session.get("as_oauth_params")

    if not params:
        return _err("invalid_request", "No active authorization request", 400)

    user   = store.USERS.get(username)
    client = store.CLIENTS.get(params["client_id"])

    if not user or user["password"] != password:
        if request.headers.get("X-Lab-Mode") == "1":
            return _err("invalid_credentials", "Invalid username or password", 401)
        return render_template("login.html",
                               client_name=client["name"] if client else "",
                               scope=params["scope"],
                               error="Invalid username or password"), 401

    session["as_user"] = username

    if request.headers.get("X-Lab-Mode") == "1":
        return jsonify({
            "step":            "2_user_authenticated",
            "username":        username,
            "name":            user["name"],
            "scope_requested": params["scope"],
            "awaiting":        "user_consent",
        })

    return render_template("consent.html",
                           client_name=client["name"],
                           scope=params["scope"],
                           username=username)


@app.route("/consent", methods=["POST"])
def consent():
    data     = request.get_json(silent=True) or request.form
    decision = data.get("decision", "deny")
    params   = session.get("as_oauth_params")
    user     = session.get("as_user")

    if not params or not user:
        return _err("invalid_request", "No active authorization request", 400)

    redirect_uri = params["redirect_uri"]
    state        = params["state"]

    if decision == "deny":
        session.pop("as_oauth_params", None)
        session.pop("as_user", None)
        deny_url = redirect_uri + "?" + urllib.parse.urlencode({
            "error": "access_denied", "state": state,
        })
        return _lab_redirect(deny_url)

    code = store.generate_code()
    store.store_auth_code(
        code=code,
        client_id=params["client_id"],
        redirect_uri=redirect_uri,
        scope=params["scope"],
        user=user,
    )
    session.pop("as_oauth_params", None)
    session.pop("as_user", None)

    callback_url = redirect_uri + "?" + urllib.parse.urlencode({
        "code": code, "state": state,
    })
    return _lab_redirect(callback_url)


@app.route("/token", methods=["POST"])
def token():
    data          = request.get_json(silent=True) or request.form
    grant_type    = data.get("grant_type",    "")
    code          = data.get("code",          "")
    redirect_uri  = data.get("redirect_uri",  "")
    client_id     = data.get("client_id",     "")
    client_secret = data.get("client_secret", "")

    if grant_type != "authorization_code":
        return _err("unsupported_grant_type", "Only authorization_code grant is supported", 400)

    client = _validate_client(client_id, client_secret)
    if not client:
        return _err("invalid_client", "Client authentication failed", 401)

    code_data = store.AUTH_CODES.get(code)
    if not code_data:
        return _err("invalid_grant", "Authorization code not found", 400)
    if code_data["used"]:
        return _err("invalid_grant", "Authorization code already used", 400)
    if time.time() > code_data["expires_at"]:
        return _err("invalid_grant", "Authorization code expired", 400)
    if code_data["client_id"] != client_id:
        return _err("invalid_grant", "client_id mismatch", 400)
    if code_data["redirect_uri"] != redirect_uri:
        return _err("invalid_grant", "redirect_uri mismatch", 400)

    store.AUTH_CODES[code]["used"] = True

    access_token = store.generate_token()
    store.store_access_token(
        token=access_token,
        client_id=client_id,
        scope=code_data["scope"],
        user=code_data["user"],
    )

    return jsonify({
        "access_token": access_token,
        "token_type":   "Bearer",
        "expires_in":   store.TOKEN_TTL,
        "scope":        code_data["scope"],
    })


@app.route("/resource")
def resource():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return _err("invalid_token", "Missing Bearer token", 401)

    token_val  = auth_header[7:]
    token_data = store.ACCESS_TOKENS.get(token_val)

    if not token_data:
        return _err("invalid_token", "Token not found", 401)
    if time.time() > token_data["expires_at"]:
        return _err("invalid_token", "Token expired", 401)

    user = store.USERS.get(token_data["user"], {})
    return jsonify({
        "user":    token_data["user"],
        "name":    user.get("name",  ""),
        "email":   user.get("email", ""),
        "scope":   token_data["scope"],
        "message": "Access granted",
        "token_info": {
            "issued_to":  token_data["client_id"],
            "expires_in": max(0, int(token_data["expires_at"] - time.time())),
        },
    })


@app.route("/api/trace")
def api_trace():
    try:
        since = int(request.args.get("since", 0))
    except (ValueError, TypeError):
        since = 0
    return jsonify(tr.get_since(since))


@app.route("/api/trace/reset", methods=["POST"])
def api_trace_reset():
    tr.reset_events()
    store.reset_store()
    session.clear()
    return jsonify({"status": "reset"})


@app.route("/api/lab/config")
def api_lab_config():
    c = list(store.CLIENTS.values())[0]
    return jsonify({
        "client": {
            "client_id":      c["client_id"],
            "client_secret":  c["client_secret"],
            "name":           c["name"],
            "allowed_scopes": c["allowed_scopes"],
            "redirect_uris":  c["redirect_uris"],
        },
        "users": [
            {"username": u, "password": d["password"],
             "name": d["name"], "email": d["email"]}
            for u, d in store.USERS.items()
        ],
        "ttl": {"code": store.CODE_TTL, "token": store.TOKEN_TTL},
        "providers": [
            {"id": "google",    "name": "Google"},
            {"id": "github",    "name": "GitHub"},
            {"id": "microsoft", "name": "Microsoft"},
        ],
    })


@app.route("/api/lab/attack/<name>", methods=["POST"])
def lab_attack(name):
    handlers = {
        "bad_secret":     _attack_bad_secret,
        "expired_code":   _attack_expired_code,
        "replayed_code":  _attack_replayed_code,
        "evil_redirect":  _attack_evil_redirect,
        "tampered_state": _attack_tampered_state,
        "fake_token":     _attack_fake_token,
        "expired_token":  _attack_expired_token,
    }
    fn = handlers.get(name)
    if not fn:
        return jsonify({"error": "unknown_attack"}), 404
    base   = _base()
    result = fn(base)
    return jsonify(result)


def _fresh_code(base: str, user: str = "alice") -> tuple:
    c    = list(store.CLIENTS.values())[0]
    code = store.generate_code()
    store.store_auth_code(
        code=code,
        client_id=c["client_id"],
        redirect_uri=f"{base}/app/callback",
        scope=" ".join(c["allowed_scopes"]),
        user=user,
    )
    return code, c


def _fresh_token(base: str, user: str = "alice") -> tuple:
    c, client = _fresh_code(base, user)
    tok = store.generate_token()
    store.store_access_token(
        token=tok,
        client_id=client["client_id"],
        scope=" ".join(client["allowed_scopes"]),
        user=user,
    )
    return tok, client


def _attack_bad_secret(base: str) -> dict:
    code, c = _fresh_code(base)
    r = http_client.post(f"{base}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{base}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": "WRONG_SECRET_ATTACK",
    }, headers={"X-Lab-Actor": "client", "X-Lab-Beat": "7"})
    body = r.json()
    return {"attack": "bad_secret", "blocked_by": "client authentication",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_expired_code(base: str) -> dict:
    code, c = _fresh_code(base)
    store.AUTH_CODES[code]["expires_at"] = time.time() - 1
    r = http_client.post(f"{base}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{base}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    }, headers={"X-Lab-Actor": "client", "X-Lab-Beat": "7"})
    body = r.json()
    return {"attack": "expired_code", "blocked_by": "code.expires_at",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_replayed_code(base: str) -> dict:
    code, c = _fresh_code(base)
    store.AUTH_CODES[code]["used"] = True
    r = http_client.post(f"{base}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{base}/app/callback",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    }, headers={"X-Lab-Actor": "client", "X-Lab-Beat": "7"})
    body = r.json()
    return {"attack": "replayed_code", "blocked_by": "code.used",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_evil_redirect(base: str) -> dict:
    code, c = _fresh_code(base)
    r = http_client.post(f"{base}/token", data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  "http://evil.example.com/steal",
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
    }, headers={"X-Lab-Actor": "client", "X-Lab-Beat": "7"})
    body = r.json()
    return {"attack": "evil_redirect", "blocked_by": "redirect_uri allow-list",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_tampered_state(base: str) -> dict:
    s = http_client.Session()
    r1 = s.post(f"{base}/app/login/start", json={"provider": "google"},
                headers={"X-Lab-Mode": "1", "X-Lab-Beat": "1"})
    auth_data = r1.json()

    s.get(auth_data["authorize_url"],
          headers={"X-Lab-Mode": "1", "X-Lab-Beat": "2"})

    s.post(f"{base}/login",
           data={"username": "alice", "password": "pass123"},
           headers={"X-Lab-Mode": "1", "X-Lab-Beat": "3"})

    r4 = s.post(f"{base}/consent",
                data={"decision": "approve"},
                headers={"X-Lab-Mode": "1", "X-Lab-Beat": "5"})
    cb_data  = r4.json()
    good_loc = cb_data.get("location", "")

    parsed = urllib.parse.urlparse(good_loc)
    params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
    params["state"] = "TAMPERED_EVIL_STATE"
    tampered_url = parsed._replace(query=urllib.parse.urlencode(params)).geturl()

    r5   = s.get(tampered_url, headers={"X-Lab-Mode": "1", "X-Lab-Beat": "6"})
    body = r5.json()
    return {"attack": "tampered_state", "blocked_by": "state check",
            "status": r5.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_fake_token(base: str) -> dict:
    r = http_client.get(f"{base}/resource",
                        headers={"Authorization": "Bearer FAKE_TOKEN_ATTACK_XXXX",
                                 "X-Lab-Actor": "client", "X-Lab-Beat": "9"})
    body = r.json()
    return {"attack": "fake_token", "blocked_by": "token lookup",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


def _attack_expired_token(base: str) -> dict:
    tok, c = _fresh_token(base)
    store.ACCESS_TOKENS[tok]["expires_at"] = time.time() - 1
    r = http_client.get(f"{base}/resource",
                        headers={"Authorization": f"Bearer {tok}",
                                 "X-Lab-Actor": "client", "X-Lab-Beat": "9"})
    body = r.json()
    return {"attack": "expired_token", "blocked_by": "token.expires_at",
            "status": r.status_code, "error": body.get("error"),
            "error_description": body.get("error_description")}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
