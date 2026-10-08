"use strict";
import * as api from "/static/js/api.js";

/* ══════════════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════════════ */

const MAX_BEAT = 10;
let beat       = 0;
let provider   = "google";

const ctx = {
  username: "alice",
  password: "pass123",
  state: null,
  authorizeUrl: null,
  authorizeParams: null,
  callbackUrl: null,
  tokenData: null,
  profile: null,
};

const history = new Array(MAX_BEAT + 1).fill(null);
let lastTraceId = 0;

const PROVIDER_CONFIGS = {
  google: {
    id: "google",
    name: "Google IdP",
    domain: "accounts.google.com",
    badge: "Google IdP",
    color: "#4285F4",
    logoSvg: `<svg width="40" height="40" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>`,
  },
  github: {
    id: "github",
    name: "GitHub IdP",
    domain: "github.com/login/oauth",
    badge: "GitHub IdP",
    color: "#24292E",
    logoSvg: `<svg width="40" height="40" viewBox="0 0 18 18" fill="white" aria-hidden="true">
      <path d="M9 1a8 8 0 0 0-2.53 15.59c.4.074.547-.174.547-.386 0-.19-.007-.693-.011-1.36-2.226.484-2.695-1.073-2.695-1.073-.364-.924-.888-1.17-.888-1.17-.726-.497.055-.487.055-.487.803.057 1.226.825 1.226.825.713 1.222 1.872.87 2.328.665.072-.517.279-.87.508-1.07-1.777-.202-3.645-.888-3.645-3.953 0-.873.312-1.587.823-2.147-.083-.202-.357-1.016.078-2.117 0 0 .672-.215 2.2.82A7.66 7.66 0 0 1 9 5.25c.68.003 1.365.092 2.004.27 1.527-1.035 2.198-.82 2.198-.82.436 1.101.162 1.915.08 2.117.512.56.822 1.274.822 2.147 0 3.073-1.871 3.749-3.653 3.947.287.248.543.735.543 1.481 0 1.07-.01 1.932-.01 2.194 0 .214.144.463.55.385A8.002 8.002 0 0 0 9 1z"/>
    </svg>`,
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft IdP",
    domain: "login.microsoftonline.com",
    badge: "Microsoft IdP",
    color: "#00A4EF",
    logoSvg: `<svg width="40" height="40" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="1"  width="7.5" height="7.5" fill="#F25022"/>
      <rect x="9.5" y="1"  width="7.5" height="7.5" fill="#7FBA00"/>
      <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF"/>
      <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900"/>
    </svg>`,
  },
};

const BEAT_STAGE = [0, 1, 2, 3, 4, 5, 5, 6, 6, 7, 7];

/* ══════════════════════════════════════════════════════════════════════
   FLOW DETAILS & DESCRIPTIONS (FOR CLASSROOM PROJECTOR)
══════════════════════════════════════════════════════════════════════ */

const BEAT_DATA = {
  0: {
    stepTitle: "STEP 0 OF 10 · READY TO BEGIN",
    channel: "idle",
    channelLabel: "FLOW READY",
    from: "User / Browser",
    to: "PhotoPrint Studio",
    arrow: "──►",
    desc: "The user is on the PhotoPrint Studio application. Click <strong>\"Continue with Google\"</strong> (or GitHub / Microsoft) on the left to start the OAuth 2.0 flow.",
    chips: ["Ready to start", "Confidential Client"],
    insight: "In OAuth 2.0, the client application never handles or stores the user's password. The user logs in directly with the chosen Identity Provider.",
    fromNode: null,
    toNode: null,
    pipeId: null,
    packet: null,
  },
  1: {
    stepTitle: "STEP 1 OF 10 · USER INITIATES SIGN-IN",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "User's Device",
    to: "PhotoPrint Server",
    arrow: "──►",
    desc: "User clicks the login button. The browser sends a request to PhotoPrint's backend: <em>\"Initiate OAuth 2.0 login with Google\"</em>.",
    chips: ["POST /app/login/start", "provider: google", "state token generated"],
    insight: "🛡️ CSRF Guard: PhotoPrint generates a random, cryptographically secure <code>state</code> token and saves it in the user's session. It will verify this token when the user returns to prevent Cross-Site Request Forgery.",
    fromNode: "browser",
    toNode: "client",
    pipeId: "pipe-browser-client",
    packet: { icon: "🚀", label: "Start OAuth Login", arrow: "▼", top: "50%", left: "23%" },
  },
  2: {
    stepTitle: "STEP 2 OF 10 · BROWSER REDIRECT TO AUTH SERVER",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "User's Device",
    to: "Google Auth Server",
    arrow: "──►",
    desc: "PhotoPrint redirects the browser to Google's official authorization endpoint with the registered <code>client_id</code>, callback <code>redirect_uri</code>, requested <code>scope</code>, and <code>state</code>.",
    chips: ["GET /authorize", "client_id: client_abc123", "scope: read:profile read:email", "state: random_token"],
    insight: "🔑 Password Isolation: Notice that PhotoPrint never asks for the user's Google password. It simply forwards the user to Google's official sign-in page.",
    fromNode: "browser",
    toNode: "auth",
    pipeId: "pipe-browser-auth",
    packet: { icon: "🔗", label: "Redirect + client_id + state", arrow: "►", top: "20%", left: "50%" },
  },
  3: {
    stepTitle: "STEP 3 OF 10 · DIRECT AUTHENTICATION ON AUTH SERVER",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "User's Device",
    to: "Google Auth Server",
    arrow: "──►",
    desc: "The user submits their username and password directly to Google's server. Google verifies their identity.",
    chips: ["POST /login", "username: alice", "Credentials verified on IdP"],
    insight: "🛡️ Zero-Knowledge for Client App: The user's password and credentials stay strictly on Google's domain. PhotoPrint cannot eavesdrop or store them.",
    fromNode: "browser",
    toNode: "auth",
    pipeId: "pipe-browser-auth",
    packet: { icon: "👤", label: "Submit Credentials (Alice)", arrow: "►", top: "20%", left: "50%" },
  },
  4: {
    stepTitle: "STEP 4 OF 10 · USER CONSENT PROMPT",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "Google Auth Server",
    to: "User's Device",
    arrow: "──►",
    desc: "Google displays the Consent Screen: <em>\"PhotoPrint Studio wants permission to read your profile and email address. Allow or Deny?\"</em>",
    chips: ["GET /consent", "Scopes: read:profile, read:email", "User decision requested"],
    insight: "📋 Principle of Least Privilege: OAuth 2.0 enforces explicit user consent. The application only receives permissions for the specific scopes the user grants.",
    fromNode: "auth",
    toNode: "browser",
    pipeId: "pipe-browser-auth",
    packet: { icon: "📋", label: "Request Permission (Scopes)", arrow: "◄", top: "20%", left: "50%" },
  },
  5: {
    stepTitle: "STEP 5 OF 10 · AUTH CODE ISSUED VIA REDIRECT",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "Google Auth Server",
    to: "User's Device",
    arrow: "──►",
    desc: "User clicks <strong>Allow access</strong>. Google generates a temporary, single-use <strong>Authorization Code</strong> and issues an HTTP 302 Redirect to the browser.",
    chips: ["302 Found", "code: code_4f9a...", "state: verified", "TTL: 60 seconds"],
    insight: "⭐ Why not send the Access Token here? The browser URL bar and browser history are untrusted public channels. Google sends only a short-lived Authorization Code (valid for 60s) that is useless without the Client Secret!",
    fromNode: "auth",
    toNode: "browser",
    pipeId: "pipe-browser-auth",
    packet: { icon: "🔑", label: "302 Redirect + auth_code", arrow: "◄", top: "20%", left: "50%" },
  },
  6: {
    stepTitle: "STEP 6 OF 10 · BROWSER DELIVERS CODE TO CLIENT APP",
    channel: "front",
    channelLabel: "FRONT CHANNEL",
    from: "User's Device",
    to: "PhotoPrint Server",
    arrow: "──►",
    desc: "The browser follows the 302 redirect and hits PhotoPrint's callback URL, delivering the <strong>Authorization Code</strong> and <strong>state</strong> parameter.",
    chips: ["GET /app/callback", "code delivered", "State validated against session"],
    insight: "🛡️ CSRF Validation: PhotoPrint verifies that the returned <code>state</code> matches the original token stored in Step 1. If an attacker tried to inject a stolen code, this check halts the attack.",
    fromNode: "browser",
    toNode: "client",
    pipeId: "pipe-browser-client",
    packet: { icon: "🔑", label: "Deliver auth_code to App", arrow: "▼", top: "50%", left: "23%" },
  },
  7: {
    stepTitle: "STEP 7 OF 10 · DIRECT BACK-CHANNEL TOKEN EXCHANGE",
    channel: "back",
    channelLabel: "🔒 BACK CHANNEL (CONFIDENTIAL)",
    from: "PhotoPrint Server",
    to: "Google Auth Server",
    arrow: "──►",
    desc: "PhotoPrint's backend directly connects to Google's <code>/token</code> endpoint over a secure server-to-server connection. It sends the <strong>Authorization Code</strong> + <strong>client_id</strong> + <strong>client_secret</strong>.",
    chips: ["POST /token", "grant_type: authorization_code", "client_secret: secret_xyz789", "Back-Channel TLS"],
    insight: "⭐ THE CORE SECURITY GUARANTEE: This is direct Server-to-Server communication (Back Channel). The user's browser NEVER sees this request! The confidential <code>client_secret</code> is never exposed to the internet or the browser.",
    fromNode: "client",
    toNode: "auth",
    pipeId: "pipe-client-auth",
    packet: { icon: "🔐", label: "POST /token (Code + Secret)", arrow: "▲", top: "50%", left: "50%" },
  },
  8: {
    stepTitle: "STEP 8 OF 10 · ACCESS TOKEN ISSUED TO BACKEND",
    channel: "back",
    channelLabel: "🔒 BACK CHANNEL (CONFIDENTIAL)",
    from: "Google Auth Server",
    to: "PhotoPrint Server",
    arrow: "──►",
    desc: "Google verifies the Client Secret, invalidates (burns) the single-use Authorization Code forever, and returns a Bearer <strong>Access Token</strong> directly to PhotoPrint's server.",
    chips: ["200 OK", "access_token: tok_9b2e...", "token_type: Bearer", "expires_in: 3600s", "Code burned"],
    insight: "🎫 Token Safety: The access token is stored safely in PhotoPrint's server-side session memory. Because the code was burned, it can never be replayed by an attacker.",
    fromNode: "auth",
    toNode: "client",
    pipeId: "pipe-client-auth",
    packet: { icon: "🎫", label: "Deliver Bearer Access Token", arrow: "▼", top: "50%", left: "50%" },
  },
  9: {
    stepTitle: "STEP 9 OF 10 · FETCHING PROTECTED USER DATA",
    channel: "back",
    channelLabel: "🔒 BACK CHANNEL (PROTECTED API)",
    from: "PhotoPrint Server",
    to: "Resource Server",
    arrow: "──►",
    desc: "PhotoPrint backend calls Google's Resource Server API (<code>/resource</code>) with the Bearer Access Token to request the user's authorized profile and email.",
    chips: ["GET /resource", "Authorization: Bearer <access_token>", "Direct Server API Call"],
    insight: "🔒 Bearer Token Authorization: The Resource Server validates the token's cryptographic integrity, expiration, and ensures it includes the <code>read:profile</code> and <code>read:email</code> scopes.",
    fromNode: "client",
    toNode: "resource",
    pipeId: "pipe-client-resource",
    packet: { icon: "🎫", label: "GET /resource + Bearer Token", arrow: "►", top: "80%", left: "50%" },
  },
  10: {
    stepTitle: "STEP 10 OF 10 · USER DASHBOARD LOADED (FLOW COMPLETE)",
    channel: "back",
    channelLabel: "FLOW COMPLETED",
    from: "Resource Server",
    to: "PhotoPrint Server",
    arrow: "──►",
    desc: "The Resource Server returns the user's name, email, and profile data. PhotoPrint establishes the user's logged-in session and renders their personalized Dashboard!",
    chips: ["200 OK", "Profile data returned", "Alice Smith logged in", "Authentication complete!"],
    insight: "🎉 Success! The user is fully authenticated. The entire flow achieved secure authorization without the third-party app ever handling the user's password, and with full token confidentiality.",
    fromNode: "resource",
    toNode: "client",
    pipeId: "pipe-client-resource",
    packet: { icon: "📦", label: "Profile Data Returned", arrow: "◄", top: "80%", left: "50%" },
  },
};

/* ══════════════════════════════════════════════════════════════════════
   BEAT EXECUTION
══════════════════════════════════════════════════════════════════════ */

const beatHandlers = {
  0: async () => ({ screen: "S0" }),

  1: async () => {
    const r = await api.loginStart(provider);
    if (!r.ok) throw r.data;
    ctx.state = r.data.state;
    ctx.authorizeUrl = r.data.authorize_url;
    ctx.authorizeParams = r.data.params;
    return { screen: "S1", traceData: r.data };
  },

  2: async () => {
    const r = await api.doAuthorize(ctx.authorizeUrl);
    if (!r.ok) throw r.data;
    return { screen: "S2", traceData: r.data };
  },

  3: async () => {
    const r = await api.doLogin(ctx.username, ctx.password);
    if (!r.ok) throw r.data;
    return { screen: "S2", traceData: r.data };
  },

  4: async () => ({ screen: "S3" }),

  5: async () => {
    const r = await api.doConsent("approve");
    if (!r.ok) throw r.data;
    ctx.callbackUrl = r.data.location;
    return { screen: "S4", traceData: r.data };
  },

  6: async () => {
    const r = await api.doCallback(ctx.callbackUrl);
    if (!r.ok) throw r.data;
    ctx.tokenData = r.data.token;
    return { screen: "S4", traceData: r.data };
  },

  7: async () => ({ screen: "S4", syntheticBeat: 7 }),

  8: async () => ({ screen: "S4", syntheticBeat: 7, showResponse: true }),

  9: async () => {
    const r = await api.doProfile();
    if (!r.ok) throw r.data;
    ctx.profile = r.data.profile;
    return { screen: "S4", traceData: r.data };
  },

  10: async () => ({ screen: "S5" }),
};

async function executeBeat(b, silent = false) {
  const handler = beatHandlers[b];
  if (!handler) return;
  try {
    const result = await handler();
    history[b] = { ...result, beat: b, error: null };
    if (!silent) {
      const fresh = await api.getTrace(lastTraceId);
      if (fresh.length) {
        lastTraceId = fresh[fresh.length - 1].id;
        history[b].traceEvents = fresh;
      }
    }
  } catch (err) {
    history[b] = { screen: "S6", beat: b, error: err };
    if (!silent) {
      const fresh = await api.getTrace(lastTraceId);
      if (fresh.length) {
        lastTraceId = fresh[fresh.length - 1].id;
        history[b].traceEvents = fresh;
      }
    }
  }
}

async function replayTo(target) {
  await api.resetAll();
  lastTraceId = 0;
  history.fill(null);
  Object.assign(ctx, {
    state: null, authorizeUrl: null, authorizeParams: null,
    callbackUrl: null, tokenData: null, profile: null,
  });
  for (let b = 0; b <= target; b++) {
    await executeBeat(b, b < target);
  }
  beat = target;
  render();
}

/* ══════════════════════════════════════════════════════════════════════
   RENDER LEFT PANE (WHAT THE USER SEES)
══════════════════════════════════════════════════════════════════════ */

const canvas     = document.getElementById("page-canvas");
const tabTitle   = document.getElementById("tab-title");
const urlBase    = document.getElementById("url-base");
const urlPath    = document.getElementById("url-path");
const paramChips = document.getElementById("param-chips");

function setTabTitle(title) {
  if (tabTitle) tabTitle.textContent = title;
  document.title = `${title} — OAuth 2.0 Virtual Lab`;
}

function setUrl(base, path, params = {}) {
  urlBase.textContent = base;
  urlPath.textContent = path || "";
  paramChips.innerHTML = "";
  for (const [k, v] of Object.entries(params)) {
    const chip = document.createElement("span");
    chip.className = `param-chip type-${k === "code" ? "code" : (k === "state" ? "state" : "default")}`;
    chip.title = `${k}=${v}`;
    chip.textContent = `${k}=${truncate(v, 14)}`;
    paramChips.appendChild(chip);
  }
}

function renderLeft(b) {
  const h = history[b];
  const screen = h ? h.screen : (b === 0 ? "S0" : "S4");

  switch (screen) {
    case "S0": renderS0(); break;
    case "S1": renderS1(); break;
    case "S2": renderS2(); break;
    case "S3": renderS3(); break;
    case "S4": renderS4(b); break;
    case "S5": renderS5(); break;
    case "S6": renderS6(h?.error); break;
    default:   renderS0();
  }
}

function renderS0() {
  setTabTitle("PhotoPrint Studio");
  setUrl("photoprint.studio", "/");
  canvas.innerHTML = "";
  const s = document.createElement("div");
  s.className = "screen";
  s.innerHTML = `
    <div class="pp-brand-header">
      <div class="pp-logo-circle">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
      <h1 class="pp-app-title">PhotoPrint Studio</h1>
      <p class="pp-tagline">Print memories. Share moments.</p>
    </div>

    <div class="auth-card">
      <h2 class="auth-card-title">Sign in to your account</h2>
      <button class="continue-btn provider-google" data-prov="google" id="btn-start-google">
        ${PROVIDER_CONFIGS.google.logoSvg}
        <span>Continue with Google</span>
      </button>
      <button class="continue-btn provider-github" data-prov="github" id="btn-start-github">
        ${PROVIDER_CONFIGS.github.logoSvg}
        <span>Continue with GitHub</span>
      </button>
      <button class="continue-btn provider-microsoft" data-prov="microsoft" id="btn-start-microsoft">
        ${PROVIDER_CONFIGS.microsoft.logoSvg}
        <span>Continue with Microsoft</span>
      </button>
    </div>`;
  canvas.appendChild(s);

  s.querySelectorAll(".continue-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const chosenProv = btn.dataset.prov;
      selectProvider(chosenProv);
      goNext();
    });
  });
}

function renderS1() {
  const pCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  setTabTitle("Redirecting…");
  const params = ctx.authorizeParams || {};
  setUrl("localhost:5000", "/authorize", {
    client_id: params.client_id || "client_abc123",
    scope: params.scope || "read:profile read:email",
    state: params.state || "...",
  });
  canvas.innerHTML = `
    <div class="screen">
      <div class="interstitial">
        <div class="interstitial-spinner" role="status"></div>
        <h2>Redirecting to ${pCfg.name}</h2>
        <p>PhotoPrint Studio is forwarding your browser to authenticate securely.</p>
      </div>
    </div>`;
}

function renderS2() {
  const pCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  setTabTitle(`Sign in — ${pCfg.name}`);
  const params = ctx.authorizeParams || {};
  setUrl("localhost:5000", "/authorize", {
    client_id: params.client_id || "client_abc123",
    state: params.state || "...",
  });
  canvas.innerHTML = "";
  const s = document.createElement("div");
  s.className = "screen";

  if (provider === "google") {
    // ── AUTHENTIC GOOGLE DARK ACCOUNT CHOOSER (MODELED DIRECTLY AFTER REAL GOOGLE OAUTH) ──
    s.innerHTML = `
      <div class="google-chooser-card">
        <div class="google-brand-row">
          ${pCfg.logoSvg}
          <span class="google-brand-title">Sign in with Google</span>
        </div>

        <h2 class="google-choose-title">Choose an account</h2>
        <p class="google-choose-sub">to continue to <span class="google-app-highlight">PhotoPrint Studio</span></p>

        <div class="google-account-list" role="listbox">
          <button class="google-account-btn" data-user="rohith" data-pass="rohith99" id="btn-acc-rohith">
            <div class="google-avatar av-rohith">R</div>
            <div class="google-account-info">
              <div class="google-acc-name">Rohith Sheregar</div>
              <div class="google-acc-email">sheregarrohith@gmail.com</div>
            </div>
            <div class="google-arrow">›</div>
          </button>

          <button class="google-account-btn" data-user="alice" data-pass="pass123" id="btn-acc-alice">
            <div class="google-avatar av-alice">A</div>
            <div class="google-account-info">
              <div class="google-acc-name">Alice Smith</div>
              <div class="google-acc-email">alice.smith@gmail.com</div>
            </div>
            <div class="google-arrow">›</div>
          </button>

          <button class="google-account-btn" data-user="bob" data-pass="letmein" id="btn-acc-bob">
            <div class="google-avatar av-bob">B</div>
            <div class="google-account-info">
              <div class="google-acc-name">Bob Johnson</div>
              <div class="google-acc-email">bob.johnson@gmail.com</div>
            </div>
            <div class="google-arrow">›</div>
          </button>

          <button class="google-account-btn" id="btn-toggle-custom">
            <div class="google-avatar av-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="google-account-info">
              <div class="google-acc-name">Use another account</div>
            </div>
            <div class="google-arrow">›</div>
          </button>
        </div>

        <div class="google-custom-login-box" id="google-custom-box">
          <label class="field-label" for="s2-user">Username</label>
          <input class="field-input" id="s2-user" type="text" value="${esc(ctx.username)}" autocomplete="username">
          <label class="field-label" for="s2-pass">Password</label>
          <input class="field-input" id="s2-pass" type="password" value="${esc(ctx.password)}" autocomplete="current-password">
          <button class="primary-lp-btn" id="s2-custom-submit">Sign In</button>
        </div>

        <p class="google-footer-disclaimer">
          Before using this app, you can review PhotoPrint Studio’s <span>Privacy Policy</span> and <span>Terms of Service</span>.
        </p>
      </div>`;

    canvas.appendChild(s);

    s.querySelectorAll(".google-account-btn[data-user]").forEach(btn => {
      btn.addEventListener("click", () => {
        ctx.username = btn.dataset.user;
        ctx.password = btn.dataset.pass;
        btn.style.background = "rgba(138, 180, 248, 0.2)";
        setTimeout(() => goNext(), 150);
      });
    });

    const customBox = s.querySelector("#google-custom-box");
    s.querySelector("#btn-toggle-custom")?.addEventListener("click", () => {
      customBox.classList.toggle("active");
      if (customBox.classList.contains("active")) {
        customBox.scrollIntoView({ behavior: "smooth" });
      }
    });

    s.querySelector("#s2-user")?.addEventListener("input", e => ctx.username = e.target.value);
    s.querySelector("#s2-pass")?.addEventListener("input", e => ctx.password = e.target.value);
    s.querySelector("#s2-custom-submit")?.addEventListener("click", () => goNext());

  } else {
    // ── GITHUB / MICROSOFT AUTHENTIC CARDS ──
    const btnClass = provider === "github" ? "github" : (provider === "microsoft" ? "microsoft" : "");
    s.innerHTML = `
      <div class="signin-card">
        <div class="signin-header">
          <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px;">
            ${pCfg.logoSvg}
            <span style="font-size:1.45rem;font-weight:800;color:#0F172A">${pCfg.name}</span>
          </div>
          <p class="signin-subtitle">Sign in to authorize <strong>PhotoPrint Studio</strong></p>
          <div class="scope-request-banner">Requested scopes: read:profile, read:email</div>
        </div>

        <div class="signin-body">
          <div class="field-label">Select Account (1-Click Demo):</div>
          <div class="demo-chips" role="group">
            <button class="demo-chip" data-user="rohith" data-pass="rohith99">Rohith</button>
            <button class="demo-chip" data-user="alice" data-pass="pass123">Alice</button>
            <button class="demo-chip" data-user="bob" data-pass="letmein">Bob</button>
          </div>

          <label class="field-label" for="s2-user">Username</label>
          <input class="field-input" id="s2-user" type="text" value="${esc(ctx.username)}" autocomplete="username">

          <label class="field-label" for="s2-pass">Password</label>
          <input class="field-input" id="s2-pass" type="password" value="${esc(ctx.password)}" autocomplete="current-password">

          <button class="primary-lp-btn ${btnClass}" id="s2-submit">Sign in with ${pCfg.badge}</button>
        </div>
      </div>`;

    canvas.appendChild(s);

    s.querySelectorAll(".demo-chip").forEach(c => {
      c.addEventListener("click", () => {
        ctx.username = c.dataset.user;
        ctx.password = c.dataset.pass;
        s.querySelector("#s2-user").value = ctx.username;
        s.querySelector("#s2-pass").value = ctx.password;
        setTimeout(() => goNext(), 150);
      });
    });
    s.querySelector("#s2-user").addEventListener("input", e => ctx.username = e.target.value);
    s.querySelector("#s2-pass").addEventListener("input", e => ctx.password = e.target.value);
    s.querySelector("#s2-submit").addEventListener("click", () => goNext());
  }
}

function renderS3() {
  const pCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  setTabTitle(`Authorize — ${pCfg.name}`);
  setUrl("localhost:5000", "/consent", {
    client: "PhotoPrint Studio",
    user: ctx.username || "alice"
  });
  canvas.innerHTML = "";
  const s = document.createElement("div");
  s.className = "screen";
  s.innerHTML = `
    <div class="consent-card">
      <div class="consent-header">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:#2563EB;color:white;margin-bottom:8px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </div>
        <h2 class="consent-app-name">PhotoPrint Studio</h2>
        <p class="consent-user-line">Signed in as <strong>${esc(ctx.username || "alice")}</strong> via ${pCfg.badge}</p>
      </div>

      <div class="scope-list">
        <div class="scope-row">
          <div class="scope-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="scope-text">
            <strong>Read Profile (read:profile)</strong>
            <span>Access your name, username, and public profile</span>
          </div>
          <span class="scope-check">✔</span>
        </div>
        <div class="scope-row">
          <div class="scope-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div class="scope-text">
            <strong>Read Email (read:email)</strong>
            <span>View your verified primary email address</span>
          </div>
          <span class="scope-check">✔</span>
        </div>
      </div>

      <div class="consent-actions">
        <button class="deny-btn" id="s3-deny">Cancel</button>
        <button class="allow-btn" id="s3-allow">Allow access</button>
      </div>
    </div>`;
  canvas.appendChild(s);

  s.querySelector("#s3-allow").addEventListener("click", () => goNext());
  s.querySelector("#s3-deny").addEventListener("click", () => denyConsent());
}

function renderS4(b) {
  const pCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  setTabTitle("Authorizing… — PhotoPrint Studio");
  setUrl("photoprint.studio", "/callback");
  const messages = {
    5: `${pCfg.badge} is issuing the single-use Authorization Code…`,
    6: "Browser delivering Authorization Code to PhotoPrint callback…",
    7: "PhotoPrint Server exchanging Code + Secret for Access Token…",
    8: "Access Token received safely in server memory…",
    9: "Fetching user profile from Resource Server…",
  };
  const msg = messages[b] || "Completing authentication…";
  canvas.innerHTML = `
    <div class="screen">
      <div class="interstitial">
        <div class="interstitial-spinner" role="status"></div>
        <h2>Signing you in</h2>
        <p>${esc(msg)}</p>
      </div>
    </div>`;
}

function renderS5() {
  setTabTitle("Dashboard — PhotoPrint Studio");
  setUrl("photoprint.studio", "/dashboard");
  const p = ctx.profile || {};
  const initial = (p.name || ctx.username || "A")[0].toUpperCase();
  canvas.innerHTML = "";
  const s = document.createElement("div");
  s.className = "screen";
  s.innerHTML = `
    <div class="dashboard">
      <div class="profile-card">
        <div class="success-banner">
          ✔ OAuth 2.0 Authentication Complete
        </div>

        <div>
          <div class="user-avatar-lg">${esc(initial)}</div>
          <h2 class="user-display-name">${esc(p.name || ctx.username || "Alice Smith")}</h2>
          <p class="user-display-email">${esc(p.email || `${ctx.username}@example.com`)}</p>
        </div>

        <div class="profile-details-list">
          <div class="detail-item">
            <span class="detail-label">Username</span>
            <span class="detail-val">${esc(p.user || ctx.username || "alice")}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Connected Provider</span>
            <span class="detail-val">${esc(PROVIDER_CONFIGS[provider]?.name || "Google")}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Granted Scopes</span>
            <span class="detail-val">${esc(p.scope || "read:profile read:email")}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Token Type</span>
            <span class="detail-val">Bearer (Stored in Backend)</span>
          </div>
        </div>

        <button class="signout-btn" id="s5-signout">Sign out &amp; Restart Flow</button>
      </div>
    </div>`;
  canvas.appendChild(s);

  s.querySelector("#s5-signout").addEventListener("click", () => restart());
}

function renderS6(err) {
  setTabTitle("Error — PhotoPrint Studio");
  setUrl("photoprint.studio", "/error");
  const error = err?.error || "access_denied";
  const desc  = err?.error_description || "Authentication was cancelled or failed.";
  canvas.innerHTML = `
    <div class="screen">
      <div class="profile-card" style="border-color:#FCA5A5">
        <div style="font-size:3rem;margin-bottom:12px;">⚠️</div>
        <h2 style="font-size:1.5rem;color:#B91C1C;margin-bottom:8px">Authentication Failed</h2>
        <p style="font-size:1.05rem;color:#475569;margin-bottom:16px">${esc(desc)}</p>
        <p style="font-family:monospace;font-size:0.85rem;color:#64748B;margin-bottom:20px">Error: ${esc(error)}</p>
        <button class="primary-lp-btn" id="s6-restart">Restart Demo</button>
      </div>
    </div>`;
  canvas.querySelector("#s6-restart")?.addEventListener("click", () => restart());
}

async function denyConsent() {
  history[beat] = {
    screen: "S6",
    beat,
    error: { error: "access_denied", error_description: "User clicked Deny on the consent screen." },
  };
  render();
}

/* ══════════════════════════════════════════════════════════════════════
   RENDER RIGHT PANE (INTERACTIVE ARCHITECTURE & EXPLAINER)
══════════════════════════════════════════════════════════════════════ */

function selectProvider(p) {
  provider = p;
  const cfg = PROVIDER_CONFIGS[p] || PROVIDER_CONFIGS.google;

  // Update the Auth Server SVG entity text labels
  const badgeEl = document.getElementById("auth-badge-text");
  const nameEl  = document.getElementById("auth-name-text");
  const domEl   = document.getElementById("auth-domain-text");

  if (badgeEl) badgeEl.textContent = (cfg.badge || "Auth Server").toUpperCase();
  if (nameEl)  nameEl.textContent  = cfg.name   || "Auth Server";
  if (domEl)   domEl.textContent   = cfg.domain || "";
}

function updateEntityDiagram(b) {
  const data = BEAT_DATA[b] || BEAT_DATA[0];

  // ── Hide all arrows, de-activate all entities ──────────────────
  for (let i = 1; i <= MAX_BEAT; i++) {
    const el = document.getElementById(`arr-${i}`);
    if (el) {
      el.classList.remove("arrow-active");
      el.style.opacity = "0";
    }
  }
  ["ent-user", "ent-auth", "ent-client", "ent-resource"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("entity-active");
  });

  // ── Activate the current beat's arrow ──────────────────────────
  if (b >= 1 && b <= MAX_BEAT) {
    const arrEl = document.getElementById(`arr-${b}`);
    if (arrEl) {
      arrEl.classList.add("arrow-active");
      arrEl.style.opacity = "1";
    }
  }

  // ── Highlight active entities per beat ─────────────────────────
  const entityMap = {
    0:  [],
    1:  ["ent-user", "ent-client"],
    2:  ["ent-user", "ent-auth"],
    3:  ["ent-user", "ent-auth"],
    4:  ["ent-auth", "ent-user"],
    5:  ["ent-auth", "ent-user"],
    6:  ["ent-user", "ent-client"],
    7:  ["ent-client", "ent-auth"],
    8:  ["ent-auth", "ent-client"],
    9:  ["ent-client", "ent-resource"],
    10: ["ent-resource", "ent-client"],
  };
  const activeIds = entityMap[b] || [];
  activeIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("entity-active");
  });

  // ── Update provider info in auth server box ─────────────────────
  const cfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  const badgeEl = document.getElementById("auth-badge-text");
  const nameEl  = document.getElementById("auth-name-text");
  const domEl   = document.getElementById("auth-domain-text");
  if (badgeEl) badgeEl.textContent = (cfg.badge || "Auth Server").toUpperCase();
  if (nameEl)  nameEl.textContent  = cfg.name  || "Auth Server";
  if (domEl)   domEl.textContent   = cfg.domain || "";
}

function updateExplanationCard(b) {
  const data = BEAT_DATA[b] || BEAT_DATA[0];

  // Update minimal 1-line intro bar on virtual lab canvas
  const introBadge = document.getElementById("intro-step-badge");
  const introSummary = document.getElementById("intro-summary");
  if (introBadge) {
    introBadge.textContent = b === 0 ? "STEP 0 · READY" : `STEP ${b} OF ${MAX_BEAT}`;
  }
  if (introSummary) {
    const shortSummaries = {
      0: 'Click "Continue with Google" on the left to start the OAuth 2.0 flow.',
      1: 'User initiates login with chosen Identity Provider.',
      2: 'Browser redirected to IdP authorization endpoint with client_id & scope.',
      3: 'User authenticates directly on IdP domain (Password isolation).',
      4: 'IdP displays consent screen for requested scopes.',
      5: 'IdP issues short-lived single-use Authorization Code via 302 redirect.',
      6: 'Browser delivers Authorization Code to PhotoPrint callback endpoint.',
      7: 'PhotoPrint backend exchanges Code + Secret directly with IdP token endpoint.',
      8: 'IdP verifies secret, burns code, and issues Bearer Access Token.',
      9: 'PhotoPrint queries Resource Server API with Bearer token in header.',
      10: 'Resource Server returns protected profile data. User signed in!',
    };
    introSummary.textContent = shortSummaries[b] || data.stepTitle;
  }

  // Update rich details inside the on-demand explanation modal
  const stepPill    = document.getElementById("explain-step-pill");
  const chanPill    = document.getElementById("explain-channel-pill");
  const descEl      = document.getElementById("explain-desc");
  const insightEl   = document.getElementById("explain-insight");

  if (stepPill) stepPill.textContent = data.stepTitle;

  if (chanPill) {
    if (data.channel === "front") {
      chanPill.textContent = "FRONT CHANNEL";
      chanPill.className = "modal-channel-badge chan-front";
    } else if (data.channel === "back") {
      chanPill.textContent = "BACK CHANNEL";
      chanPill.className = "modal-channel-badge chan-back";
    } else {
      chanPill.textContent = "IDLE";
      chanPill.className = "modal-channel-badge chan-idle";
    }
  }

  if (descEl)    descEl.innerHTML    = data.desc;
  if (insightEl) insightEl.innerHTML = data.insight;
}

/* ══════════════════════════════════════════════════════════════════════
   STEPPER & MAIN RENDER
══════════════════════════════════════════════════════════════════════ */

function renderStepper(b) {
  const stage = BEAT_STAGE[b] || 0;
  document.querySelectorAll(".step-item").forEach(el => {
    const s = parseInt(el.dataset.stage);
    el.classList.remove("active", "done");
    if (s === stage)    el.classList.add("active");
    else if (s < stage) el.classList.add("done");
  });
}

function render() {
  renderLeft(beat);
  updateEntityDiagram(beat);
  updateExplanationCard(beat);
  renderStepper(beat);
  updateTechnicalInspector(beat);
  updateInlineInspector(beat);

  // Counter
  document.getElementById("step-counter").textContent = `Step ${beat} / ${MAX_BEAT}`;

  // Disable back when at 0, disable next when at 10
  const isStart = beat === 0;
  const isEnd   = beat === MAX_BEAT;

  document.getElementById("top-btn-back").disabled     = isStart;
  document.getElementById("browser-btn-back").disabled = isStart;

  document.getElementById("top-btn-next").disabled     = isEnd;
  document.getElementById("browser-btn-next").disabled = isEnd;
}

/* ══════════════════════════════════════════════════════════════════════
   TECHNICAL HTTP & JSON INSPECTOR
══════════════════════════════════════════════════════════════════════ */

function getTechnicalData(b) {
  const pCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.google;
  const user = ctx.username || "rohith";
  const stateVal = ctx.state || "state_9e31a8bc4f";
  const authCode = "code_4f9a78e2d19b841a";
  const accessToken = ctx.tokenData?.access_token || "tok_8f93a102b4c7e651";

  switch (b) {
    case 0:
      return {
        method: "READY",
        methodClass: "method-get",
        endpoint: "/app/login (Client Home)",
        status: "200 OK",
        channel: "Flow Ready",
        json: {
          client_application: {
            name: "PhotoPrint Studio",
            client_id: "client_abc123",
            client_type: "confidential_client",
            registered_redirect_uris: [
              "http://localhost:5000/app/callback",
              "http://127.0.0.1:5000/app/callback"
            ],
            requested_scopes: ["read:profile", "read:email"]
          },
          status: "Waiting for user to choose identity provider",
          protocol: "OAuth 2.0 Authorization Code Grant (RFC 6749)"
        }
      };

    case 1:
      return {
        method: "POST",
        methodClass: "method-post",
        endpoint: "/app/login/start",
        status: "200 OK",
        channel: "Front Channel",
        json: {
          http_request: {
            endpoint: "/app/login/start",
            method: "POST",
            body: { provider: provider }
          },
          http_response: {
            status: "ready",
            state_generated: stateVal,
            authorize_url: `http://localhost:5000/authorize?client_id=client_abc123&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fapp%2Fcallback&scope=read%3Aprofile+read%3Aemail&state=${stateVal}`
          },
          security_context: {
            csrf_protection: "Cryptographic state token stored in client session",
            client_secret_exposed_to_browser: false
          }
        }
      };

    case 2:
      return {
        method: "GET",
        methodClass: "method-302",
        endpoint: "/authorize (Front-Channel 302)",
        status: "302 Redirect",
        channel: "Front Channel",
        json: {
          http_request: {
            method: "GET",
            host: pCfg.domain,
            path: "/authorize",
            query_parameters: {
              client_id: "client_abc123",
              response_type: "code",
              redirect_uri: "http://localhost:5000/app/callback",
              scope: "read:profile read:email",
              state: stateVal
            }
          },
          auth_server_validation: {
            client_id_valid: true,
            redirect_uri_whitelisted: true,
            response_type_supported: "code",
            client_secret_sent_now: false
          }
        }
      };

    case 3:
      return {
        method: "POST",
        methodClass: "method-post",
        endpoint: "/login (Direct to IdP)",
        status: "200 OK",
        channel: "Front Channel",
        json: {
          http_request: {
            method: "POST",
            host: pCfg.domain,
            path: "/login",
            body: {
              username: user,
              password: "••••••••"
            }
          },
          auth_server_result: {
            authenticated: true,
            user_subject: `usr_${user}`,
            session_established_on: pCfg.domain,
            password_seen_by_client_app: false
          }
        }
      };

    case 4:
      return {
        method: "GET",
        methodClass: "method-get",
        endpoint: "/consent (Consent Screen)",
        status: "200 OK",
        channel: "Front Channel",
        json: {
          consent_evaluation: {
            client_id: "client_abc123",
            client_name: "PhotoPrint Studio",
            requested_scopes: [
              { scope: "read:profile", description: "View your public profile and name" },
              { scope: "read:email", description: "View your verified email address" }
            ],
            user: user,
            consent_granted_so_far: false
          }
        }
      };

    case 5:
      return {
        method: "302",
        methodClass: "method-302",
        endpoint: "302 Redirect with Auth Code",
        status: "302 Found",
        channel: "Front Channel",
        json: {
          http_response: {
            status: 302,
            headers: {
              Location: `http://localhost:5000/app/callback?code=${authCode}&state=${stateVal}`
            }
          },
          issued_authorization_code: {
            code: authCode,
            state: stateVal,
            ttl_seconds: 60,
            single_use_only: true,
            security_guarantee: "Useless to interceptors without confidential Client Secret"
          }
        }
      };

    case 6:
      return {
        method: "GET",
        methodClass: "method-get",
        endpoint: "/app/callback",
        status: "200 OK",
        channel: "Front Channel",
        json: {
          http_request: {
            method: "GET",
            path: "/app/callback",
            query_parameters: {
              code: authCode,
              state: stateVal
            }
          },
          client_security_verification: {
            incoming_state: stateVal,
            session_state: stateVal,
            state_match: true,
            csrf_protection_status: "PASSED"
          }
        }
      };

    case 7:
      return {
        method: "POST",
        methodClass: "method-post",
        endpoint: "/token (Back Channel Private TLS)",
        status: "POST Server-to-Server",
        channel: "🔒 Back Channel",
        json: {
          http_request: {
            method: "POST",
            path: "/token",
            channel: "Private Server-to-Server TLS (Direct backend link, invisible to browser)",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "PhotoPrint-Backend/1.0"
            },
            body: {
              grant_type: "authorization_code",
              code: authCode,
              redirect_uri: "http://localhost:5000/app/callback",
              client_id: "client_abc123",
              client_secret: "secret_xyz789"
            }
          },
          security_guarantee: "Client Secret is NEVER exposed to browser, DOM, or public network"
        }
      };

    case 8:
      return {
        method: "200",
        methodClass: "method-200",
        endpoint: "/token response",
        status: "200 OK · Bearer Token",
        channel: "🔒 Back Channel",
        json: {
          http_response: {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Pragma": "no-cache"
            },
            body: {
              access_token: accessToken,
              token_type: "Bearer",
              expires_in: 3600,
              scope: "read:profile read:email"
            }
          },
          auth_server_action: {
            auth_code_burned: true,
            code_replay_allowed: false,
            access_token_stored: "Client App backend session memory"
          }
        }
      };

    case 9:
      return {
        method: "GET",
        methodClass: "method-get",
        endpoint: "/resource (Protected API)",
        status: "GET · Bearer Auth",
        channel: "🔒 Back Channel",
        json: {
          http_request: {
            method: "GET",
            path: "/resource",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
              "X-Client-ID": "client_abc123"
            }
          },
          resource_server_validation: {
            token_valid: true,
            signature_checked: true,
            scopes_authorized: ["read:profile", "read:email"],
            token_expired: false
          }
        }
      };

    case 10:
      return {
        method: "200",
        methodClass: "method-200",
        endpoint: "/resource response",
        status: "200 OK · Flow Complete",
        channel: "Flow Complete",
        json: {
          http_response: {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            },
            body: {
              id: user === "rohith" ? 3 : (user === "bob" ? 2 : 1),
              username: user,
              name: user === "rohith" ? "Rohith Sheregar" : (user === "bob" ? "Bob Johnson" : "Alice Smith"),
              email: user === "rohith" ? "sheregarrohith@gmail.com" : (user === "bob" ? "bob.johnson@gmail.com" : "alice.smith@gmail.com"),
              provider: provider,
              scopes_granted: ["read:profile", "read:email"],
              session_active: true
            }
          },
          summary: "OAuth 2.0 Authorization Code Flow successfully finished without password sharing!"
        }
      };
    default:
      return null;
  }
}

function syntaxHighlightJson(jsonObj) {
  const jsonStr = JSON.stringify(jsonObj, null, 2);
  return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-num';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-str';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-bool';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${esc(match)}</span>`;
  });
}

function updateTechnicalInspector(b) {
  const data = getTechnicalData(b);
  if (!data) return;

  const methodEl = document.getElementById("tech-method");
  const endpointEl = document.getElementById("tech-endpoint");
  const statusEl = document.getElementById("tech-status");
  const jsonEl = document.getElementById("tech-json-content");

  if (methodEl) {
    methodEl.textContent = data.method;
    methodEl.className = `tech-method-pill ${data.methodClass}`;
  }
  if (endpointEl) {
    endpointEl.textContent = data.endpoint;
  }
  if (statusEl) {
    statusEl.textContent = `${data.status} · ${data.channel}`;
  }
  if (jsonEl) {
    jsonEl.innerHTML = syntaxHighlightJson(data.json);
  }
}

function getCallbackCode() {
  if (!ctx.callbackUrl) return null;
  try {
    return new URL(ctx.callbackUrl, window.location.origin).searchParams.get("code");
  } catch {
    return null;
  }
}

function credentialPreview(value, fallback = "Not issued") {
  if (!value) return fallback;
  return `${String(value).slice(0, 18)}…`;
}

function updateInlineInspector(b) {
  const data = getTechnicalData(b);
  if (!data) return;

  const request = data.json?.http_request || data.json?.request || data.json;
  const response = data.json?.http_response || data.json?.response || data.json;
  const requestLabel = data.json?.http_request ? `${data.json.http_request.method || data.method} ${data.json.http_request.path || data.endpoint}` : "Protocol snapshot";
  const responseLabel = data.json?.http_response ? `${data.json.http_response.status || data.status}` : data.status;

  const methodEl = document.getElementById("inline-tech-method");
  const endpointEl = document.getElementById("inline-tech-endpoint");
  const statusEl = document.getElementById("inline-tech-status");
  const requestEl = document.getElementById("inline-request-json");
  const responseEl = document.getElementById("inline-response-json");
  const requestLabelEl = document.getElementById("inline-request-label");
  const responseLabelEl = document.getElementById("inline-response-label");

  if (methodEl) {
    methodEl.textContent = data.method;
    methodEl.className = `tech-method-pill ${data.methodClass}`;
  }
  if (endpointEl) endpointEl.textContent = data.endpoint;
  if (statusEl) statusEl.textContent = `${data.status} · ${data.channel}`;
  if (requestEl) requestEl.innerHTML = syntaxHighlightJson(request);
  if (responseEl) responseEl.innerHTML = syntaxHighlightJson(response);
  if (requestLabelEl) requestLabelEl.textContent = requestLabel;
  if (responseLabelEl) responseLabelEl.textContent = responseLabel;

  const status = document.getElementById("inline-flow-status");
  const state = document.getElementById("inline-state-value");
  const code = document.getElementById("inline-code-value");
  const token = document.getElementById("inline-token-value");
  if (status) status.textContent = b === MAX_BEAT ? "Complete" : b === 0 ? "Ready" : "In progress";
  if (state) state.textContent = credentialPreview(ctx.state, "Pending");
  if (code) code.textContent = credentialPreview(getCallbackCode());
  if (token) token.textContent = credentialPreview(ctx.tokenData?.access_token);
}

/* ══════════════════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════════════════ */

async function goNext() {
  if (beat >= MAX_BEAT) return;
  beat++;
  if (!history[beat]) await executeBeat(beat);
  render();
}

async function goBack() {
  if (beat <= 0) return;
  beat--;
  render();
}

async function restart() {
  beat = 0;
  await api.resetAll();
  lastTraceId = 0;
  history.fill(null);
  Object.assign(ctx, {
    state: null, authorizeUrl: null, authorizeParams: null,
    callbackUrl: null, tokenData: null, profile: null,
  });
  render();
}

/* ══════════════════════════════════════════════════════════════════════
   EVENT LISTENERS & BINDINGS
══════════════════════════════════════════════════════════════════════ */

// Top navigation arrow buttons
document.getElementById("top-btn-next")?.addEventListener("click", goNext);
document.getElementById("top-btn-back")?.addEventListener("click", goBack);
document.getElementById("top-btn-restart")?.addEventListener("click", restart);

// Browser chrome navigation buttons
document.getElementById("browser-btn-next")?.addEventListener("click", goNext);
document.getElementById("browser-btn-back")?.addEventListener("click", goBack);
document.getElementById("browser-btn-reload")?.addEventListener("click", restart);

// The simulated browser page can also be used as a large "next" target.
// Interactive controls keep their own behavior and do not bubble into this.
canvas.addEventListener("click", (event) => {
  if (beat >= MAX_BEAT) return;
  if (event.target.closest("button, a, input, select, textarea, label")) return;
  goNext();
});

// Stepper click to replay to stage
document.querySelectorAll(".step-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const stage = parseInt(btn.dataset.stage);
    const targetBeat = BEAT_STAGE.indexOf(stage);
    if (targetBeat >= 0) {
      replayTo(targetBeat);
    }
  });
});

// Copy technical JSON payload
document.getElementById("tech-copy-btn")?.addEventListener("click", () => {
  const data = getTechnicalData(beat);
  if (!data) return;
  const rawJson = JSON.stringify(data.json, null, 2);
  navigator.clipboard.writeText(rawJson).then(() => {
    const textEl = document.getElementById("copy-btn-text");
    if (textEl) {
      textEl.textContent = "Copied ✓";
      setTimeout(() => { textEl.textContent = "Copy JSON"; }, 2000);
    }
  }).catch(() => {
    // Fallback if clipboard API is restricted
    const textEl = document.getElementById("copy-btn-text");
    if (textEl) {
      textEl.textContent = "Copied ✓";
      setTimeout(() => { textEl.textContent = "Copy JSON"; }, 2000);
    }
  });
});

document.getElementById("inline-tech-copy-btn")?.addEventListener("click", () => {
  const data = getTechnicalData(beat);
  if (!data) return;
  const rawJson = JSON.stringify(data.json, null, 2);
  navigator.clipboard.writeText(rawJson).then(() => {
    const textEl = document.getElementById("inline-copy-btn-text");
    if (textEl) {
      textEl.textContent = "Copied ✓";
      setTimeout(() => { textEl.textContent = "Copy JSON"; }, 2000);
    }
  }).catch(() => {
    const textEl = document.getElementById("inline-copy-btn-text");
    if (textEl) textEl.textContent = "Copy unavailable";
  });
});

// Keep the technical details below the animation; this control only scrolls to them.
const btnOpenExplain = document.getElementById("btn-open-explain");
btnOpenExplain?.addEventListener("click", () => {
  document.getElementById("technical-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Keyboard navigation
document.addEventListener("keydown", async e => {
  if (e.key === "Escape") {
    return;
  }
  if (e.target.tagName === "INPUT") return;
  if (e.key === "i" || e.key === "I" || e.key === "?") {
    e.preventDefault();
    document.getElementById("technical-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  switch (e.key) {
    case "ArrowRight":
      e.preventDefault();
      await goNext();
      break;
    case "ArrowLeft":
      e.preventDefault();
      await goBack();
      break;
    case "r":
    case "R":
      e.preventDefault();
      await restart();
      break;
  }
});

/* ══════════════════════════════════════════════════════════════════════
   INITIALIZATION
══════════════════════════════════════════════════════════════════════ */

const urlParams = new URLSearchParams(location.search);
const deepBeat  = parseInt(urlParams.get("beat") ?? "0");
const deepProv  = urlParams.get("provider") ?? "google";

if (PROVIDER_CONFIGS[deepProv]) {
  selectProvider(deepProv);
} else {
  selectProvider("google");
}

if (deepBeat > 0 && deepBeat <= MAX_BEAT) {
  replayTo(deepBeat);
} else {
  render();
}

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════ */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.substring(0, n) + "…" : s;
}
