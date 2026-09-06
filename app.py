"""
app.py — OAuth2 Authorization Code Grant Simulation
Group 29: Rohith, Nishith R Poojary

Simulates three roles inside one Flask app:
  /authorize, /login, /consent  → Authorization Server
  /token                        → Authorization Server (token endpoint)
  /resource                     → Resource Server
  /client/*                     → Client App helpers (used by the lab UI)
  /lab                          → Serves the virtual lab page
"""

import os
import time
from flask import (Flask, request, jsonify, redirect, render_template,
                   session, url_for, send_from_directory)
import store

app = Flask(__name__)
app.secret_key = "oauth2-lab-secret-do-not-use-in-production"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def json_error(msg: str, code: int):
    return jsonify({"error": msg}), code


def validate_client(client_id: str, client_secret: str):
    """Return client dict or None."""
    c = store.CLIENTS.get(client_id)
    if c and c["client_secret"] == client_secret:
        return c
    return None


# ---------------------------------------------------------------------------
# Root → lab
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return redirect(url_for("lab"))


@app.route("/lab")
def lab():
    return render_template("lab.html")

@app.route("/report")
def report():
    return send_from_directory("report", "report.html")


# ===========================================================================
# AUTHORIZATION SERVER
# ===========================================================================

@app.route("/authorize", methods=["GET"])
def authorize():
    """
    Step 1 — Client redirects user here with:
        client_id, redirect_uri, scope, state, response_type
    We validate params then show the login page.
    """
    client_id    = request.args.get("client_id", "")
    redirect_uri = request.args.get("redirect_uri", "")
    scope        = request.args.get("scope", "")
    state        = request.args.get("state", "")
    response_type = request.args.get("response_type", "")

    # --- validation ---
    if response_type != "code":
        return json_error("unsupported_response_type", 400)

    client = store.CLIENTS.get(client_id)
    if not client:
        return json_error("invalid_client", 400)

    if redirect_uri not in client["redirect_uris"]:
        return json_error("invalid_redirect_uri", 400)

    requested_scopes = scope.split()
    invalid_scopes = [s for s in requested_scopes if s not in client["allowed_scopes"]]
    if invalid_scopes:
        return json_error(f"invalid_scope: {invalid_scopes}", 400)

    # Store OAuth params in session so login/consent can access them
    session["oauth_params"] = {
        "client_id":    client_id,
        "redirect_uri": redirect_uri,
        "scope":        scope,
        "state":        state,
    }

    return render_template("login.html",
                           client_name=client["name"],
                           scope=scope)


@app.route("/login", methods=["POST"])
def login():
    """
    Step 2 — User submits username + password.
    Validate credentials then show consent screen.
    """
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    params   = session.get("oauth_params")

    if not params:
        return json_error("no_active_authorization_request", 400)

    user = store.USERS.get(username)
    if not user or user["password"] != password:
        client = store.CLIENTS.get(params["client_id"])
        return render_template("login.html",
                               client_name=client["name"],
                               scope=params["scope"],
                               error="Invalid username or password"), 401

    session["logged_in_user"] = username
    client = store.CLIENTS.get(params["client_id"])
    return render_template("consent.html",
                           client_name=client["name"],
                           scope=params["scope"],
                           username=username)


@app.route("/consent", methods=["POST"])
def consent():
    """
    Step 3 — User approves or denies the scope.
    On approve: generate auth code, redirect to client's redirect_uri.
    """
    decision = request.form.get("decision", "deny")
    params   = session.get("oauth_params")
    user     = session.get("logged_in_user")

    if not params or not user:
        return json_error("no_active_authorization_request", 400)

    redirect_uri = params["redirect_uri"]
    state        = params["state"]

    if decision == "deny":
        return redirect(f"{redirect_uri}?error=access_denied&state={state}")

    # Generate authorization code
    code = store.generate_code()
    store.store_auth_code(
        code=code,
        client_id=params["client_id"],
        redirect_uri=redirect_uri,
        scope=params["scope"],
        user=user,
    )

    # Clean up session
    session.pop("oauth_params", None)
    session.pop("logged_in_user", None)

    return redirect(f"{redirect_uri}?code={code}&state={state}")


@app.route("/token", methods=["POST"])
def token():
    """
    Step 4 — Client exchanges authorization code for access token.
    Accepts application/x-www-form-urlencoded or JSON.
    """
    # Support both JSON and form-encoded bodies
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    grant_type    = data.get("grant_type", "")
    code          = data.get("code", "")
    redirect_uri  = data.get("redirect_uri", "")
    client_id     = data.get("client_id", "")
    client_secret = data.get("client_secret", "")

    if grant_type != "authorization_code":
        return json_error("unsupported_grant_type", 400)

    # Validate client credentials
    client = validate_client(client_id, client_secret)
    if not client:
        return json_error("invalid_client_credentials", 401)

    # Validate the authorization code
    code_data = store.AUTH_CODES.get(code)

    if not code_data:
        return json_error("invalid_code", 400)

    if code_data["used"]:
        return json_error("code_already_used", 400)

    if time.time() > code_data["expires_at"]:
        return json_error("code_expired", 400)

    if code_data["client_id"] != client_id:
        return json_error("client_id_mismatch", 400)

    if code_data["redirect_uri"] != redirect_uri:
        return json_error("redirect_uri_mismatch", 400)

    # Mark code as used (single-use enforcement)
    store.AUTH_CODES[code]["used"] = True

    # Issue access token
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


# ===========================================================================
# RESOURCE SERVER
# ===========================================================================

@app.route("/resource", methods=["GET"])
def resource():
    """
    Step 5 — Client accesses protected resource.
    Requires: Authorization: Bearer <access_token>
    """
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        return json_error("missing_or_invalid_authorization_header", 401)

    token = auth_header[len("Bearer "):]
    token_data = store.ACCESS_TOKENS.get(token)

    if not token_data:
        return json_error("invalid_token", 401)

    if time.time() > token_data["expires_at"]:
        return json_error("token_expired", 401)

    user = store.USERS.get(token_data["user"], {})
    return jsonify({
        "message":    "Access granted to protected resource",
        "user":       token_data["user"],
        "name":       user.get("name", ""),
        "email":      user.get("email", ""),
        "scope":      token_data["scope"],
        "token_info": {
            "issued_to":  token_data["client_id"],
            "expires_in": max(0, int(token_data["expires_at"] - time.time())),
        }
    })


# ===========================================================================
# CLIENT HELPER ENDPOINTS (used by the lab frontend)
# ===========================================================================

@app.route("/client/start", methods=["POST"])
def client_start():
    """
    Lab UI calls this to get the authorize URL parameters.
    Returns the URL the client would redirect the user to.
    """
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    client_id    = data.get("client_id", "client_abc123")
    scope        = data.get("scope", "read:profile read:email")
    state        = data.get("state", store.generate_code()[:8])
    redirect_uri = "http://localhost:5000/callback"

    authorize_url = (
        f"http://localhost:5000/authorize"
        f"?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scope}"
        f"&state={state}"
    )

    return jsonify({
        "step":          "1_client_redirect",
        "description":   "Client prepares authorization request",
        "authorize_url": authorize_url,
        "parameters": {
            "response_type": "code",
            "client_id":     client_id,
            "redirect_uri":  redirect_uri,
            "scope":         scope,
            "state":         state,
        }
    })


@app.route("/client/login", methods=["POST"])
def client_login():
    """
    Lab UI proxy for /login — returns JSON instead of rendering HTML.
    """
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    username  = data.get("username", "")
    password  = data.get("password", "")
    client_id = data.get("client_id", "client_abc123")
    scope     = data.get("scope", "read:profile read:email")
    state     = data.get("state", "")
    redirect_uri = "http://localhost:5000/callback"

    # Validate client
    client = store.CLIENTS.get(client_id)
    if not client:
        return json_error("invalid_client", 400)

    # Validate redirect_uri
    if redirect_uri not in client["redirect_uris"]:
        return json_error("invalid_redirect_uri", 400)

    # Validate user
    user = store.USERS.get(username)
    if not user or user["password"] != password:
        return json_error("invalid_credentials", 401)

    # Store in session for consent step
    session["oauth_params"] = {
        "client_id":    client_id,
        "redirect_uri": redirect_uri,
        "scope":        scope,
        "state":        state,
    }
    session["logged_in_user"] = username

    return jsonify({
        "step":        "2_user_authenticated",
        "description": "User credentials verified by Authorization Server",
        "username":    username,
        "name":        user["name"],
        "scope_requested": scope,
        "awaiting":    "user_consent",
    })


@app.route("/client/consent", methods=["POST"])
def client_consent():
    """
    Lab UI proxy for /consent — returns JSON with the auth code.
    """
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    decision = data.get("decision", "approve")
    params   = session.get("oauth_params")
    user     = session.get("logged_in_user")

    if not params or not user:
        return json_error("no_active_session — complete login step first", 400)

    if decision == "deny":
        session.pop("oauth_params", None)
        session.pop("logged_in_user", None)
        return json_error("access_denied_by_user", 403)

    code = store.generate_code()
    store.store_auth_code(
        code=code,
        client_id=params["client_id"],
        redirect_uri=params["redirect_uri"],
        scope=params["scope"],
        user=user,
    )

    code_data = store.AUTH_CODES[code]
    state     = params["state"]

    # Clean up session
    session.pop("oauth_params", None)
    session.pop("logged_in_user", None)

    return jsonify({
        "step":        "3_authorization_code_issued",
        "description": "Authorization Server issues short-lived code, redirects to client",
        "redirect_to": f"{params['redirect_uri']}?code={code}&state={state}",
        "code":        code,
        "state":       state,
        "expires_in":  store.CODE_TTL,
        "expires_at":  code_data["expires_at"],
        "scope":       params["scope"],
    })


@app.route("/client/token", methods=["POST"])
def client_token():
    """
    Lab UI proxy for /token — wraps the token exchange and returns richer JSON.
    """
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    code          = data.get("code", "")
    client_id     = data.get("client_id", "client_abc123")
    client_secret = data.get("client_secret", "secret_xyz789")
    redirect_uri  = "http://localhost:5000/callback"

    grant_type = "authorization_code"

    # Reuse main token logic
    client = validate_client(client_id, client_secret)
    if not client:
        return json_error("invalid_client_credentials", 401)

    code_data = store.AUTH_CODES.get(code)

    if not code_data:
        return json_error("invalid_code", 400)
    if code_data["used"]:
        return json_error("code_already_used — replay attack detected", 400)
    if time.time() > code_data["expires_at"]:
        return json_error("code_expired", 400)
    if code_data["client_id"] != client_id:
        return json_error("client_id_mismatch", 400)
    if code_data["redirect_uri"] != redirect_uri:
        return json_error("redirect_uri_mismatch", 400)

    store.AUTH_CODES[code]["used"] = True

    access_token = store.generate_token()
    store.store_access_token(
        token=access_token,
        client_id=client_id,
        scope=code_data["scope"],
        user=code_data["user"],
    )

    return jsonify({
        "step":         "4_token_issued",
        "description":  "Client exchanges auth code for access token",
        "request_sent": {
            "grant_type":    grant_type,
            "code":          code,
            "client_id":     client_id,
            "client_secret": client_secret,
            "redirect_uri":  redirect_uri,
        },
        "response": {
            "access_token": access_token,
            "token_type":   "Bearer",
            "expires_in":   store.TOKEN_TTL,
            "scope":        code_data["scope"],
        }
    })


@app.route("/client/resource", methods=["POST"])
def client_resource():
    """
    Lab UI proxy for /resource — shows request headers and response together.
    """
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form

    access_token = data.get("access_token", "")

    token_data = store.ACCESS_TOKENS.get(access_token)

    if not token_data:
        return json_error("invalid_token", 401)

    if time.time() > token_data["expires_at"]:
        return json_error("token_expired", 401)

    user = store.USERS.get(token_data["user"], {})

    return jsonify({
        "step":        "5_resource_accessed",
        "description": "Client accesses protected resource using Bearer token",
        "request_sent": {
            "method":  "GET",
            "url":     "http://localhost:5000/resource",
            "headers": {"Authorization": f"Bearer {access_token}"},
        },
        "response": {
            "status":  200,
            "user":    token_data["user"],
            "name":    user.get("name", ""),
            "email":   user.get("email", ""),
            "scope":   token_data["scope"],
            "message": "Access granted to protected resource",
        }
    })


@app.route("/client/reset", methods=["POST"])
def client_reset():
    """Reset all stored codes and tokens (lab Reset button)."""
    store.reset_store()
    session.clear()
    return jsonify({"status": "reset", "message": "All codes and tokens cleared"})


@app.route("/client/info", methods=["GET"])
def client_info():
    """Return registered client info for the lab UI to pre-fill fields."""
    c = list(store.CLIENTS.values())[0]
    return jsonify({
        "client_id":     c["client_id"],
        "client_secret": c["client_secret"],
        "name":          c["name"],
        "allowed_scopes": c["allowed_scopes"],
        "redirect_uris": c["redirect_uris"],
    })


@app.route("/client/inspect", methods=["GET"])
def client_inspect():
    """Live snapshot of in-memory codes and tokens for the lab inspector."""
    now = time.time()
    codes = []
    for code, data in store.AUTH_CODES.items():
        codes.append({
            "preview":    code[:16] + "…",
            "user":       data["user"],
            "scope":      data["scope"],
            "used":       data["used"],
            "expired":    now > data["expires_at"],
            "ttl":        max(0, int(data["expires_at"] - now)),
        })
    tokens = []
    for token, data in store.ACCESS_TOKENS.items():
        tokens.append({
            "preview":    token[:16] + "…",
            "user":       data["user"],
            "scope":      data["scope"],
            "expired":    now > data["expires_at"],
            "ttl":        max(0, int(data["expires_at"] - now)),
        })
    return jsonify({
        "codes":  codes,
        "tokens": tokens,
        "users":  list(store.USERS.keys()),
        "now":    int(now),
    })


# ===========================================================================
# Callback endpoint (simulates the client's redirect_uri)
# ===========================================================================

@app.route("/callback")
def callback():
    """
    Simulated client callback — the Authorization Server redirects here.
    In the lab flow this is intercepted by JS; this route just returns JSON
    for completeness / curl testing.
    """
    code  = request.args.get("code", "")
    state = request.args.get("state", "")
    error = request.args.get("error", "")

    if error:
        return jsonify({"error": error, "state": state}), 400

    return jsonify({
        "received": "authorization_code",
        "code":     code,
        "state":    state,
        "next":     "POST /token with code + client credentials",
    })


@app.route("/client/test/expire_code", methods=["POST"])
def expire_code():
    data = request.get_json() or {}
    code = data.get("code")
    if code in store.AUTH_CODES:
        store.AUTH_CODES[code]["expires_at"] = time.time() - 1
        return jsonify({"status": "expired"})
    return jsonify({"error": "not found"}), 404

@app.route("/client/test/expire_token", methods=["POST"])
def expire_token():
    data = request.get_json() or {}
    token = data.get("token")
    if token in store.ACCESS_TOKENS:
        store.ACCESS_TOKENS[token]["expires_at"] = time.time() - 1
        return jsonify({"status": "expired"})
    return jsonify({"error": "not found"}), 404

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
