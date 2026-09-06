"use strict";

const flow = {
  step: 0,
  code: null,
  token: null,
  tokenPayload: null,
  stateSent: null,
  stateReturned: null,
  expiresAt: null,
  timer: null,
  demoRunning: false,
  skipScroll: false,
  packets: [],
  viewing: -1,
};

const stepMeta = [
  {
    title: "Prepare the authorization request",
    why: "The client redirects the user’s browser to the Authorization Server. It never asks for the password itself.",
    from: "Client",
    to: "Authorization Server",
    path: "GET /authorize",
  },
  {
    title: "Authenticate the resource owner",
    why: "Only the Authorization Server verifies username and password. The third-party app stays out of that exchange.",
    from: "User / Client browser",
    to: "Authorization Server",
    path: "POST /login",
  },
  {
    title: "Grant consent and issue a code",
    why: "Approval creates a short-lived authorization code. The code is useless without the client secret.",
    from: "Authorization Server",
    to: "Client",
    path: "302 /callback?code&state",
  },
  {
    title: "Exchange the authorization code",
    why: "The confidential client authenticates itself at /token. A stolen code cannot be redeemed without the secret.",
    from: "Client",
    to: "Authorization Server",
    path: "POST /token",
  },
  {
    title: "Receive the access token",
    why: "Inspect the Bearer token that came back. In production this travels only over TLS.",
    from: "Authorization Server",
    to: "Client",
    path: "200 application/json",
  },
  {
    title: "Call the protected resource",
    why: "The Resource Server accepts Authorization: Bearer and returns user data only if the token is valid.",
    from: "Client",
    to: "Resource Server",
    path: "GET /resource",
  },
];

const elements = {
  forms: [...document.querySelectorAll(".step-form")],
  flowSteps: [...document.querySelectorAll(".flow-step")],
  seqRows: [...document.querySelectorAll(".seq-row")],
  actorClient: document.getElementById("actor-client"),
  actorAuth: document.getElementById("actor-auth"),
  actorResource: document.getElementById("actor-resource"),
  progressLabel: document.getElementById("progressLabel"),
  stepEyebrow: document.getElementById("stepEyebrow"),
  stepTitle: document.getElementById("stepTitle"),
  whyBox: document.getElementById("whyBox"),
  stateBadge: document.getElementById("stateBadge"),
  toast: document.getElementById("toast"),
  clientId: document.getElementById("clientId"),
  scope: document.getElementById("scope"),
  stateValue: document.getElementById("stateValue"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  clientSecret: document.getElementById("clientSecret"),
  authCode: document.getElementById("authCode"),
  accessToken: document.getElementById("accessToken"),
  consentText: document.getElementById("consentText"),
  scopeList: document.getElementById("scopeList"),
  codeCredential: document.getElementById("codeCredential"),
  tokenCredential: document.getElementById("tokenCredential"),
  stateCredential: document.getElementById("stateCredential"),
  codeDisplay: document.getElementById("codeDisplay"),
  tokenDisplay: document.getElementById("tokenDisplay"),
  stateDisplay: document.getElementById("stateDisplay"),
  codeLife: document.getElementById("codeLife"),
  tokenLife: document.getElementById("tokenLife"),
  stateLife: document.getElementById("stateLife"),
  resultPanel: document.getElementById("resultPanel"),
  tokenPreview: document.getElementById("tokenPreview"),
  serverStatus: document.getElementById("serverStatus"),
  storeBox: document.getElementById("storeBox"),
  narrator: document.getElementById("narrator"),
  narratorStep: document.getElementById("narratorStep"),
  narratorText: document.getElementById("narratorText"),
  theater: document.getElementById("theater"),
  packetEyebrow: document.getElementById("packetEyebrow"),
  packetTitle: document.getElementById("packetTitle"),
  packetPath: document.getElementById("packetPath"),
  requestFrom: document.getElementById("requestFrom"),
  requestBody: document.getElementById("requestBody"),
  responsePane: document.getElementById("responsePane"),
  responseStatus: document.getElementById("responseStatus"),
  responseBody: document.getElementById("responseBody"),
  packetTabs: document.getElementById("packetTabs"),
};

function pretty(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function shortValue(value, length = 14) {
  return value ? `${value.slice(0, length)}…` : "Not issued";
}

function timeStamp() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  setTimeout(() => {
    elements.toast.className = "toast";
  }, 2200);
}

function keepStageVisible() {
  if (flow.skipScroll) return;
  const diagram = document.getElementById("flowDiagram");
  if (!diagram) return;
  diagram.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: await response.json() };
}

const ARROW_MS = 2000;

function setSequencePosition(stepIndex) {
  elements.seqRows.forEach((row, index) => {
    row.classList.remove("firing", "active");
    row.classList.toggle("done", index < stepIndex);
    if (index === stepIndex) row.classList.add("active");
  });
}

function fireSequence(stepIndex) {
  setSequencePosition(stepIndex);
  const row = elements.seqRows[stepIndex];
  if (!row) return;
  row.classList.remove("firing");
  void row.offsetWidth;
  row.classList.add("active", "firing");
}

function setActors(step) {
  elements.actorClient.classList.toggle("active", step === 0 || step === 3 || step === 5);
  elements.actorAuth.classList.toggle("active", step >= 0 && step <= 4);
  elements.actorResource.classList.toggle("active", step === 5);
}

function setActiveStep(step, hasError = false) {
  flow.step = step;
  const meta = stepMeta[step];
  elements.stepEyebrow.textContent = `Step ${String(step + 1).padStart(2, "0")}`;
  elements.stepTitle.textContent = meta.title;
  elements.whyBox.textContent = meta.why;
  elements.progressLabel.textContent = `Step ${step + 1} of 6`;

  elements.stateBadge.className = "status-pill";
  if (hasError) {
    elements.stateBadge.textContent = "Rejected";
    elements.stateBadge.classList.add("error");
  } else if (step === 5 && flow.token && !elements.resultPanel.hidden) {
    elements.stateBadge.textContent = "Complete";
    elements.stateBadge.classList.add("done");
  } else {
    elements.stateBadge.textContent = "In progress";
  }

  elements.flowSteps.forEach((item, index) => {
    item.className = `flow-step ${index < step ? "complete" : ""} ${index === step ? "active" : ""}`;
  });
  elements.forms.forEach((form, index) => {
    form.hidden = index !== step;
  });

  setSequencePosition(step);
  setActors(step);
  keepStageVisible();
}

function renderPacket(packet, pending = false) {
  elements.packetEyebrow.textContent = packet.label;
  elements.packetTitle.textContent = `${packet.from}  →  ${packet.to}`;
  elements.packetPath.textContent = `${packet.method} ${packet.path}`;
  elements.requestFrom.textContent = `${packet.from} · ${timeStamp()}`;
  elements.requestBody.textContent = pretty(packet.request);
  elements.responsePane.className = `packet-pane response ${pending ? "pending" : packet.ok ? "ok" : "err"}`;
  elements.responseStatus.textContent = pending
    ? "Waiting for server…"
    : packet.ok
      ? `Accepted · ${packet.status || 200}`
      : `Rejected · ${packet.status || "error"}`;
  elements.responseBody.textContent = pending
    ? "Packet in flight. The Authorization or Resource Server has not answered yet."
    : pretty(packet.response);
  keepStageVisible();
}

function renderPacketTabs() {
  if (!flow.packets.length) {
    elements.packetTabs.hidden = true;
    elements.packetTabs.innerHTML = "";
    return;
  }
  elements.packetTabs.hidden = false;
  elements.packetTabs.innerHTML = flow.packets
    .map((packet, index) => `
      <button type="button" data-packet="${index}" class="${index === flow.viewing ? "active" : ""} ${packet.ok ? "" : "err"}">
        ${packet.short}
      </button>
    `)
    .join("");
}

function showOutgoing(meta) {
  const packet = {
    label: meta.label,
    short: meta.short,
    method: meta.method,
    path: meta.path,
    from: meta.from,
    to: meta.to,
    request: meta.request,
    response: null,
    ok: false,
    status: null,
    pending: true,
  };
  renderPacket(packet, true);
  elements.stateBadge.textContent = "Sending";
  elements.stateBadge.className = "status-pill sending";
}

function commitPacket(meta, response, ok, status) {
  const packet = {
    label: meta.label,
    short: meta.short,
    method: meta.method,
    path: meta.path,
    from: meta.from,
    to: meta.to,
    request: meta.request,
    response,
    ok,
    status,
  };
  flow.packets.push(packet);
  flow.viewing = flow.packets.length - 1;
  renderPacket(packet, false);
  renderPacketTabs();
}

async function sendStep(meta, endpoint, actualRequest) {
  showOutgoing(meta);
  fireSequence(flow.step);
  await wait(ARROW_MS);
  const result = await postJson(endpoint, actualRequest);
  commitPacket(meta, result.data, result.ok, result.status);
  refreshStore();
  if (!result.ok) {
    showToast(result.data.error || "Request rejected", "error");
    setActiveStep(flow.step, true);
    return null;
  }
  return result.data;
}

function renderScopes(scope) {
  const descriptions = {
    "read:profile": ["Profile", "Read the name and username"],
    "read:email": ["Email", "Read the email address"],
  };
  elements.scopeList.innerHTML = scope
    .split(/\s+/)
    .filter(Boolean)
    .map((scopeName) => {
      const [title, description] = descriptions[scopeName] || [scopeName, "Requested custom permission"];
      return `<div><div><strong>${title}</strong><span>${description}</span></div><code>${scopeName}</code></div>`;
    })
    .join("");
}

function startCodeTimer() {
  clearInterval(flow.timer);
  const updateTimer = () => {
    const secondsLeft = Math.max(0, Math.ceil(flow.expiresAt - Date.now() / 1000));
    elements.codeLife.textContent = secondsLeft
      ? `Expires in ${secondsLeft}s · single-use`
      : "Expired — /token will reject this code";
    elements.codeCredential.classList.toggle("expired", secondsLeft === 0);
    if (secondsLeft === 0) clearInterval(flow.timer);
  };
  updateTimer();
  flow.timer = setInterval(updateTimer, 1000);
}

async function refreshStore() {
  try {
    const response = await fetch("/client/inspect");
    if (!response.ok) return;
    const data = await response.json();
    if (!data.codes.length && !data.tokens.length) {
      elements.storeBox.innerHTML = '<p class="store-empty">In-memory store is empty.</p>';
      return;
    }
    const codeHtml = data.codes.map((item) => `
      <div class="store-item ${item.used || item.expired ? "dead" : ""}">
        <strong>code ${item.preview}</strong>
        <span>${item.user} · ${item.used ? "used" : item.expired ? "expired" : item.ttl + "s left"}</span>
      </div>
    `).join("");
    const tokenHtml = data.tokens.map((item) => `
      <div class="store-item token ${item.expired ? "dead" : ""}">
        <strong>token ${item.preview}</strong>
        <span>${item.user} · ${item.expired ? "expired" : item.ttl + "s left"}</span>
      </div>
    `).join("");
    elements.storeBox.innerHTML = codeHtml + tokenHtml;
  } catch {
    /* keep last snapshot */
  }
}

function resetPacketBoard() {
  flow.packets = [];
  flow.viewing = -1;
  elements.packetEyebrow.textContent = "Waiting";
  elements.packetTitle.textContent = "No packet yet";
  elements.packetPath.textContent = "—";
  elements.requestFrom.textContent = "From · To";
  elements.requestBody.textContent = "Click a step or run the guided demo. The outbound JSON appears here.";
  elements.responseBody.textContent = "The matching server JSON will land on this side of the same stage.";
  elements.responseStatus.textContent = "Waiting";
  elements.responsePane.className = "packet-pane response";
  renderPacketTabs();
}

function resetInterface() {
  flow.code = null;
  flow.token = null;
  flow.tokenPayload = null;
  flow.stateSent = null;
  flow.stateReturned = null;
  flow.expiresAt = null;
  flow.skipScroll = false;
  clearInterval(flow.timer);

  elements.authCode.value = "";
  elements.accessToken.value = "";
  elements.clientSecret.value = "secret_xyz789";
  elements.codeDisplay.textContent = "Not issued";
  elements.tokenDisplay.textContent = "Not issued";
  elements.stateDisplay.textContent = "Pending";
  elements.codeLife.textContent = "TTL ≈ 60s · single-use";
  elements.tokenLife.textContent = "TTL ≈ 1 hour · Bearer";
  elements.stateLife.textContent = "Must round-trip unchanged";
  elements.codeCredential.className = "credential-card";
  elements.tokenCredential.className = "credential-card";
  elements.stateCredential.className = "credential-card";
  elements.resultPanel.hidden = true;
  elements.tokenPreview.textContent = "";
  elements.stateValue.value = `csrf_${Math.random().toString(36).slice(2, 10)}`;
  document.querySelectorAll(".security-test").forEach((btn) => {
    btn.classList.remove("pass", "fail-run");
  });
  resetPacketBoard();
  setActiveStep(0);
  refreshStore();
}

function markChallenge(button, passed) {
  button.classList.toggle("pass", passed);
  button.classList.toggle("fail-run", !passed);
}

function setTheater(on) {
  document.body.classList.toggle("theater-mode", on);
  elements.narrator.hidden = !on;
  if (on) keepStageVisible();
}

elements.packetTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-packet]");
  if (!button) return;
  const index = Number(button.dataset.packet);
  flow.viewing = index;
  renderPacket(flow.packets[index], false);
  renderPacketTabs();
});

elements.forms[0].addEventListener("submit", async (event) => {
  event.preventDefault();
  const request = {
    client_id: elements.clientId.value.trim(),
    scope: elements.scope.value.trim(),
    state: elements.stateValue.value.trim() || `csrf_${crypto.randomUUID().slice(0, 8)}`,
  };
  flow.stateSent = request.state;
  elements.stateDisplay.textContent = request.state;
  elements.stateCredential.classList.add("issued");

  const response = await sendStep(
    {
      label: "Step 1 · Client redirect",
      short: "1 /authorize",
      method: "GET",
      path: "/authorize",
      from: "Client",
      to: "Authorization Server",
      request: { response_type: "code", ...request, redirect_uri: "http://localhost:5000/callback" },
    },
    "/client/start",
    request,
  );
  if (response) {
    renderScopes(request.scope);
    showToast("Authorization request prepared", "success");
    setActiveStep(1);
  }
});

elements.forms[1].addEventListener("submit", async (event) => {
  event.preventDefault();
  const request = {
    client_id: elements.clientId.value,
    username: elements.username.value.trim(),
    password: elements.password.value,
    scope: elements.scope.value.trim(),
    state: flow.stateSent,
  };
  const response = await sendStep(
    {
      label: "Step 2 · User login",
      short: "2 /login",
      method: "POST",
      path: "/login",
      from: "User",
      to: "Authorization Server",
      request: { ...request, password: "[redacted]" },
    },
    "/client/login",
    request,
  );
  if (response) {
    elements.consentText.textContent = `${response.name} is signed in. Approve only the listed scopes.`;
    showToast("User authenticated", "success");
    setActiveStep(2);
  }
});

elements.forms[2].addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await sendStep(
    {
      label: "Step 3 · Consent and code",
      short: "3 /consent",
      method: "POST",
      path: "/consent → 302 callback",
      from: "Authorization Server",
      to: "Client",
      request: { decision: "approve" },
    },
    "/client/consent",
    { decision: "approve" },
  );
  if (response) {
    flow.code = response.code;
    flow.stateReturned = response.state;
    flow.expiresAt = response.expires_at;
    elements.authCode.value = response.code;
    elements.codeDisplay.textContent = shortValue(response.code);
    elements.codeCredential.classList.add("issued");
    const matched = flow.stateSent === flow.stateReturned;
    elements.stateLife.textContent = matched
      ? `Round-trip OK · ${flow.stateSent}`
      : "Mismatch — CSRF check would fail";
    elements.stateCredential.classList.toggle("match", matched);
    startCodeTimer();
    showToast("Authorization code issued", "success");
    setActiveStep(3);
  }
});

document.getElementById("denyBtn").addEventListener("click", async () => {
  const meta = {
    label: "Step 3 · Consent denied",
    short: "3 deny",
    method: "POST",
    path: "/consent",
    from: "User",
    to: "Authorization Server",
    request: { decision: "deny" },
  };
  showOutgoing(meta);
  const response = await postJson("/client/consent", { decision: "deny" });
  commitPacket(meta, response.data, false, response.status);
  showToast("Authorization was denied", "error");
  setActiveStep(2, true);
  refreshStore();
});

elements.forms[3].addEventListener("submit", async (event) => {
  event.preventDefault();
  const request = {
    code: flow.code,
    client_id: elements.clientId.value,
    client_secret: elements.clientSecret.value,
  };
  const response = await sendStep(
    {
      label: "Step 4 · Code exchange",
      short: "4 /token",
      method: "POST",
      path: "/token",
      from: "Client",
      to: "Authorization Server",
      request: { grant_type: "authorization_code", ...request, client_secret: "[redacted]" },
    },
    "/client/token",
    request,
  );
  if (response) {
    flow.token = response.response.access_token;
    flow.tokenPayload = response.response;
    elements.accessToken.value = `Bearer ${flow.token}`;
    elements.tokenDisplay.textContent = shortValue(flow.token);
    elements.tokenLife.textContent = `Valid for ${response.response.expires_in}s`;
    elements.tokenCredential.classList.add("issued");
    elements.tokenPreview.textContent = JSON.stringify(response.response, null, 2);
    clearInterval(flow.timer);
    elements.codeLife.textContent = "Consumed · replay is blocked";
    showToast("Access token issued", "success");
    setActiveStep(4);
  }
});

elements.forms[4].addEventListener("submit", async (event) => {
  event.preventDefault();
  fireSequence(4);
  await wait(ARROW_MS);
  const packet = {
    label: "Step 5 · Access token issued",
    short: "5 token",
    method: "200",
    path: "token response",
    from: "Authorization Server",
    to: "Client",
    request: { note: "No extra HTTP call. This is the token payload from POST /token." },
    response: flow.tokenPayload,
    ok: true,
    status: 200,
  };
  flow.packets.push(packet);
  flow.viewing = flow.packets.length - 1;
  renderPacket(packet, false);
  renderPacketTabs();
  setActiveStep(5);
});

elements.forms[5].addEventListener("submit", async (event) => {
  event.preventDefault();
  flow.skipScroll = true;
  const response = await sendStep(
    {
      label: "Step 6 · Protected resource",
      short: "6 /resource",
      method: "GET",
      path: "/resource",
      from: "Client",
      to: "Resource Server",
      request: { headers: { Authorization: `Bearer ${shortValue(flow.token, 18)}` } },
    },
    "/client/resource",
    { access_token: flow.token },
  );
  if (response) {
    elements.resultPanel.hidden = false;
    elements.resultPanel.innerHTML = `
      <span>Protected resource unlocked</span>
      <strong>${response.response.name}</strong>
      <small>${response.response.email} · scope: ${response.response.scope} · user: ${response.response.user}</small>
    `;
    elements.stateBadge.textContent = "Complete";
    elements.stateBadge.className = "status-pill done";
    elements.flowSteps.forEach((item) => {
      item.classList.add("complete");
      item.classList.remove("active");
    });
    elements.seqRows.forEach((row) => {
      row.classList.add("done");
      row.classList.remove("active", "firing");
    });
    showToast("Protected resource returned", "success");
    elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

document.querySelectorAll("[data-user]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-user]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    elements.username.value = button.dataset.user;
    elements.password.value = button.dataset.password;
  });
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  flow.demoRunning = false;
  setTheater(false);
  await fetch("/client/reset", { method: "POST" });
  resetInterface();
  showToast("Lab reset");
});

const demoLines = [
  "Watch the left pane: the client sends GET /authorize with client_id, scope, redirect_uri, and state.",
  "The right pane will show the Authorization Server accepting that request. Next, the user logs in.",
  "Password stays with the Authorization Server. The client never receives it.",
  "Consent issues a 60-second, single-use code. Compare state on the way back — that is CSRF protection.",
  "The client now proves itself with client_secret and POSTs the code to /token.",
  "The right pane holds the access_token. That is the credential the API will accept.",
  "Finally the client calls GET /resource with Authorization: Bearer. The profile JSON is the protected data.",
];

document.getElementById("demoBtn").addEventListener("click", async () => {
  if (flow.demoRunning) return;
  flow.demoRunning = true;
  setTheater(true);
  await fetch("/client/reset", { method: "POST" });
  resetInterface();
  keepStageVisible();

  const clicks = [
    ["form-0", 1, demoLines[0]],
    ["form-1", 2, demoLines[2]],
    ["form-2", 3, demoLines[3]],
    ["form-3", 4, demoLines[4]],
    ["form-4", 5, demoLines[5]],
  ];

  for (let i = 0; i < clicks.length; i += 1) {
    if (!flow.demoRunning) return;
    const [formId, expectedStep, line] = clicks[i];
    elements.narratorStep.textContent = `STEP ${i + 1}`;
    elements.narratorText.textContent = line;
    keepStageVisible();
    await wait(600);
    document.getElementById(formId).dispatchEvent(new Event("submit", { cancelable: true }));
    for (let attempt = 0; attempt < 120 && flow.step !== expectedStep && flow.demoRunning; attempt += 1) {
      await wait(100);
    }
    if (flow.step !== expectedStep) {
      flow.demoRunning = false;
      setTheater(false);
      return;
    }
    elements.narratorText.textContent = "Request on the left, response on the right — this hop is complete.";
    await wait(1600);
  }

  if (!flow.demoRunning) return;
  elements.narratorStep.textContent = "STEP 6";
  elements.narratorText.textContent = demoLines[6];
  await wait(600);
  elements.forms[5].dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(ARROW_MS + 1600);
  elements.narratorText.textContent = "Flow complete. The protected profile is shown under Access Resource.";
  await wait(1600);
  flow.demoRunning = false;
  setTheater(false);
});

document.querySelectorAll("[data-challenge]").forEach((button) => {
  button.addEventListener("click", async () => {
    const challenge = button.dataset.challenge;
    keepStageVisible();

    if (challenge === "secret") {
      if (!flow.code) {
        showToast("Issue an authorization code first (complete step 3)");
        return;
      }
      const request = { code: flow.code, client_id: elements.clientId.value, client_secret: "incorrect_secret" };
      const meta = {
        label: "Test · invalid client_secret",
        short: "fail secret",
        method: "POST",
        path: "/token",
        from: "Attacker",
        to: "Authorization Server",
        request: { ...request, client_secret: "[wrong]" },
      };
      showOutgoing(meta);
      const response = await postJson("/client/token", request);
      commitPacket(meta, response.data, response.ok, response.status);
      markChallenge(button, !response.ok);
      showToast(!response.ok ? "Impersonation blocked" : "Unexpected success", !response.ok ? "success" : "error");
      refreshStore();
      return;
    }

    if (challenge === "expire-code") {
      if (!flow.code) {
        showToast("Issue an authorization code first");
        return;
      }
      await postJson("/client/test/expire_code", { code: flow.code });
      const request = { code: flow.code, client_id: elements.clientId.value, client_secret: "secret_xyz789" };
      const meta = {
        label: "Test · expired authorization code",
        short: "fail expiry",
        method: "POST",
        path: "/token",
        from: "Client",
        to: "Authorization Server",
        request,
      };
      showOutgoing(meta);
      const response = await postJson("/client/token", request);
      commitPacket(meta, response.data, response.ok, response.status);
      markChallenge(button, !response.ok);
      elements.codeLife.textContent = "Expired — /token rejected this code";
      elements.codeCredential.classList.add("expired");
      showToast(!response.ok ? "Expired code blocked" : "Unexpected success", !response.ok ? "success" : "error");
      refreshStore();
      return;
    }

    if (challenge === "replay") {
      if (!flow.code) {
        showToast("Complete the token exchange first, then replay the same code");
        return;
      }
      const request = { code: flow.code, client_id: elements.clientId.value, client_secret: "secret_xyz789" };
      const meta = {
        label: "Test · reused authorization code",
        short: "fail replay",
        method: "POST",
        path: "/token",
        from: "Attacker",
        to: "Authorization Server",
        request: { ...request, client_secret: "[redacted]" },
      };
      showOutgoing(meta);
      const response = await postJson("/client/token", request);
      commitPacket(meta, response.data, response.ok, response.status);
      markChallenge(button, !response.ok);
      showToast(!response.ok ? "Replay blocked" : "Complete token exchange, then retry", !response.ok ? "success" : "error");
      refreshStore();
      return;
    }

    if (challenge === "redirect") {
      const url = "/authorize?response_type=code&client_id=client_abc123&redirect_uri=http://evil.example/steal&scope=read:profile&state=lab";
      const meta = {
        label: "Test · mismatched redirect_uri",
        short: "fail redirect",
        method: "GET",
        path: "/authorize",
        from: "Malicious client",
        to: "Authorization Server",
        request: { redirect_uri: "http://evil.example/steal" },
      };
      showOutgoing(meta);
      const response = await fetch(url);
      const data = await response.json();
      commitPacket(meta, data, response.ok, response.status);
      markChallenge(button, !response.ok);
      showToast(!response.ok ? "Unregistered redirect_uri rejected" : "Unexpected success", !response.ok ? "success" : "error");
      return;
    }

    if (challenge === "bad-token") {
      const meta = {
        label: "Test · invalid access token",
        short: "fail token",
        method: "GET",
        path: "/resource",
        from: "Client",
        to: "Resource Server",
        request: { Authorization: "Bearer totally_fake_token" },
      };
      showOutgoing(meta);
      const response = await fetch("/resource", { headers: { Authorization: "Bearer totally_fake_token" } });
      const data = await response.json();
      commitPacket(meta, data, response.ok, response.status);
      markChallenge(button, !response.ok);
      showToast(!response.ok ? "Junk token rejected with 401" : "Unexpected success", !response.ok ? "success" : "error");
      return;
    }

    if (challenge === "expire-token") {
      if (!flow.token) {
        showToast("Issue an access token first (complete step 4)");
        return;
      }
      await postJson("/client/test/expire_token", { token: flow.token });
      const meta = {
        label: "Test · expired access token",
        short: "fail TTL",
        method: "GET",
        path: "/resource",
        from: "Client",
        to: "Resource Server",
        request: { authorization: "Bearer [expired]" },
      };
      showOutgoing(meta);
      const response = await postJson("/client/resource", { access_token: flow.token });
      commitPacket(meta, response.data, response.ok, response.status);
      markChallenge(button, !response.ok);
      showToast(!response.ok ? "Expired token blocked" : "Unexpected success", !response.ok ? "success" : "error");
      refreshStore();
      return;
    }

    if (challenge === "state") {
      if (!flow.stateReturned) {
        showToast("Complete consent so the code callback can return state");
        return;
      }
      const matched = flow.stateSent === flow.stateReturned;
      commitPacket(
        {
          label: "Test · state round-trip",
          short: "state",
          method: "CHECK",
          path: "callback state",
          from: "Client",
          to: "Client",
          request: { sent: flow.stateSent },
        },
        { returned: flow.stateReturned, match: matched },
        matched,
        matched ? 200 : 400,
      );
      markChallenge(button, matched);
      showToast(matched ? "state bound the callback to this session" : "state mismatch", matched ? "success" : "error");
    }
  });
});

async function checkServer() {
  try {
    const response = await fetch("/client/info");
    const statusText = elements.serverStatus.querySelector("span");
    elements.serverStatus.classList.toggle("online", response.ok);
    statusText.textContent = response.ok ? "Server online" : "Server unavailable";
  } catch {
    elements.serverStatus.classList.remove("online");
    elements.serverStatus.querySelector("span").textContent = "Server unavailable";
  }
}

checkServer();
setInterval(checkServer, 10000);
setInterval(refreshStore, 2500);
setActiveStep(0);
refreshStore();
