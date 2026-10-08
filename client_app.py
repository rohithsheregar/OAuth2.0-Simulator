import secrets
import urllib.parse

import requests as http
from flask import Blueprint, g, jsonify, request, session

bp = Blueprint("client_bp", __name__)


def _base() -> str:
    return request.host_url.rstrip("/")


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
    token_resp = http.post(
        f"{base}/token",
        data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  f"{base}/app/callback",
            "client_id":     "client_abc123",
            "client_secret": "secret_xyz789",
        },
        headers={"X-Lab-Actor": "client", "X-Lab-Beat": "7"},
    )
    token_body = token_resp.json()
    if not token_resp.ok:
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
    res  = http.get(
        f"{base}/resource",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Lab-Actor":   "client",
            "X-Lab-Beat":    "9",
        },
    )
    body = res.json()
    if not res.ok:
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
