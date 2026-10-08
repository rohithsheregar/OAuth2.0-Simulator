import secrets
import urllib.parse

from flask import Blueprint, current_app, g, jsonify, request, session

bp = Blueprint("client_bp", __name__)


def _base() -> str:
    return request.host_url.rstrip("/")


def _internal_request(method: str, path: str, *, base: str, **kwargs):
    """Call another local route without making the service call itself over HTTP."""
    trace_keys = (
        "_lab_beat", "_lab_req_body", "_lab_req_headers", "_lab_req_query",
    )
    outer_trace = {key: getattr(g, key, None) for key in trace_keys}
    try:
        with current_app.test_client() as internal_client:
            return getattr(internal_client, method)(path, base_url=base, **kwargs)
    finally:
        # The nested request shares Flask's application context. Restore the
        # callback/profile request metadata before its own after_request hook.
        for key, value in outer_trace.items():
            setattr(g, key, value)


@bp.route("/app/login/start", methods=["POST"])
def login_start():
    data     = request.get_json(force=True) or {}
    provider = data.get("provider", "google")
    state    = secrets.token_urlsafe(12)
    session["app_state"]    = state
    session["app_provider"] = provider

    base   = _base()
    params = {
        "response_type": "code",
        "client_id":     "client_abc123",
        "redirect_uri":  f"{base}/app/callback",
        "scope":         "read:profile read:email",
        "state":         state,
    }
    authorize_url = f"{base}/authorize?" + urllib.parse.urlencode(params)
    return jsonify({
        "authorize_url": authorize_url,
        "params":        params,
        "state":         state,
        "provider":      provider,
    })


@bp.route("/app/callback")
def app_callback():
    code  = request.args.get("code",  "")
    state = request.args.get("state", "")
    error = request.args.get("error", "")

    if error:
        return jsonify({"error": error, "blocked_by": "user denied"}), 400

    stored_state = session.get("app_state")
    if not stored_state or state != stored_state:
        return jsonify({
            "error":             "state_mismatch",
            "error_description": "State parameter mismatch",
            "blocked_by":        "state check",
        }), 400

    base = _base()
    # Dispatch the back-channel token request inside this process. A normal
    # requests.post() back to the public Render URL deadlocks when the service
    # has its default single synchronous Gunicorn worker: /app/callback holds
    # the worker while waiting for /token to receive a worker of its own.
    # Flask's internal client preserves the same request/response behavior and
    # still lets the app's tracing hooks record the /token exchange.
    token_data = {
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  f"{base}/app/callback",
        "client_id":     "client_abc123",
        "client_secret": "secret_xyz789",
    }
    token_resp = _internal_request(
        "post",
        "/token",
        base=base,
        data=token_data,
        headers={
            "X-Lab-Actor": "client",
            "X-Lab-Beat": "7",
            "X-Lab-Mode": "1",
        },
    )
    token_body = token_resp.get_json(silent=True) or {}
    if not token_resp.is_json or token_resp.status_code >= 400:
        return jsonify(token_body), token_resp.status_code

    session["app_token"] = token_body["access_token"]
    return jsonify({
        "step":     "6_8_callback_complete",
        "state_ok": True,
        "token":    token_body,
    })


@bp.route("/app/profile")
def app_profile():
    token = session.get("app_token")
    if not token:
        return jsonify({
            "error":             "no_token",
            "error_description": "No access token in session",
        }), 401

    base = _base()
    res  = _internal_request(
        "get",
        "/resource",
        base=base,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Lab-Actor":   "client",
            "X-Lab-Beat":    "9",
            "X-Lab-Mode":    "1",
        },
    )
    body = res.get_json(silent=True) or {}
    if not res.is_json or res.status_code >= 400:
        return jsonify(body), res.status_code

    session["app_profile"] = body
    return jsonify({"profile": body})


@bp.route("/app/me")
def app_me():
    return jsonify(session.get("app_profile") or {})


@bp.route("/app/logout", methods=["POST"])
def app_logout():
    for key in ("app_token", "app_profile", "app_state", "app_provider"):
        session.pop(key, None)
    return jsonify({"status": "logged_out"})
