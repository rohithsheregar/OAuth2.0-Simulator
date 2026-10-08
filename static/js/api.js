const LAB = {"X-Lab-Mode": "1"};

function labHeaders(beat) {
  if (beat == null) return LAB;
  return {...LAB, "X-Lab-Beat": String(beat)};
}

async function post(url, body, beat, extra = {}) {
  const isJson = typeof body === "object" && !(body instanceof URLSearchParams);
  const r = await fetch(url, {
    method: "POST",
    headers: {...labHeaders(beat), "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded", ...extra},
    body: isJson ? JSON.stringify(body) : body,
    credentials: "same-origin",
  });
  const json = await r.json().catch(() => ({}));
  return {ok: r.ok, status: r.status, data: json};
}

async function get(url, beat, extra = {}) {
  const r = await fetch(url, {
    headers: {...labHeaders(beat), ...extra},
    credentials: "same-origin",
  });
  const json = await r.json().catch(() => ({}));
  return {ok: r.ok, status: r.status, data: json};
}

export async function loginStart(provider) {
  return post("/app/login/start", {provider}, 1);
}

export async function doAuthorize(authorizeUrl) {
  return get(authorizeUrl, 2);
}

export async function doLogin(username, password) {
  return post("/login", new URLSearchParams({username, password}), 3);
}

export async function doConsent(decision) {
  return post("/consent", new URLSearchParams({decision}), 5);
}

export async function doCallback(callbackUrl) {
  return get(callbackUrl, 6);
}

export async function doProfile() {
  return get("/app/profile", 9);
}

export async function getTrace(sinceId = 0) {
  const r = await fetch(`/api/trace?since=${sinceId}`, {credentials: "same-origin"});
  return r.json().catch(() => []);
}

export async function resetAll() {
  await fetch("/api/trace/reset", {method: "POST", credentials: "same-origin"});
}

export async function getConfig() {
  const r = await fetch("/api/lab/config", {credentials: "same-origin"});
  return r.json();
}

export async function runAttack(name) {
  const r = await fetch(`/api/lab/attack/${name}`, {method: "POST", credentials: "same-origin"});
  return r.json().catch(() => ({}));
}
