const $ = (id) => document.getElementById(id);

// When deployed, the frontend and backend are often different origins.
// Set `window.__API_BASE__` in `index.html` to your deployed backend base URL.
const API_BASE = window.__API_BASE__ || "";

function setHint(el, msg, isError) {
  el.textContent = msg || "";
  el.classList.toggle("error", Boolean(isError));
}

function getToken() {
  try {
    return localStorage.getItem("jwtToken");
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    localStorage.setItem("jwtToken", token);
  } catch {
    // ignore
  }
}

async function postJson(url, body, { token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return json;
}

async function main() {
  const signupBtn = $("signupBtn");
  const loginBtn = $("loginBtn");
  const askBtn = $("askBtn");
  const clearBtn = $("clearBtn");
  const downloadBtn = $("downloadBtn");

  const emailEl = $("email");
  const passwordEl = $("password");
  const authHintEl = $("authHint");
  const promptEl = $("prompt");
  const sessionIdEl = $("sessionId");
  const fileInputEl = $("fileInput");
  const fileStatusEl = $("fileStatus");
  const statusEl = $("status");
  const responseEl = $("response");

  function setBusy(isBusy) {
    signupBtn.disabled = isBusy;
    loginBtn.disabled = isBusy;
    askBtn.disabled = isBusy;
    clearBtn.disabled = isBusy;
    downloadBtn.disabled = isBusy;
  }

  function ensureSessionId() {
    let sid = (sessionIdEl?.value || "").trim();
    if (sid) return sid;

    // Auto-generate so the client can run immediately.
    sid = `client-session-${Date.now()}`;
    sessionIdEl.value = sid;
    return sid;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  fileInputEl.addEventListener("change", async () => {
    try {
      const files = Array.from(fileInputEl.files || []);
      if (!files.length) {
        setHint(fileStatusEl, "", false);
        return;
      }

      setHint(fileStatusEl, "Reading files...", false);

      const parts = [];
      let totalChars = 0;
      for (const f of files) {
        const text = await readFileAsText(f);
        totalChars += text.length;
        parts.push(`=== FILE: ${f.name} ===\n${text}`);
      }

      const joined = parts.join("\n\n---\n\n");
      promptEl.value = joined;
      setHint(fileStatusEl, `Loaded ${files.length} file(s). Total chars: ${totalChars}.`, false);
    } catch (e) {
      setHint(fileStatusEl, e.message || String(e), true);
    }
  });

  signupBtn.addEventListener("click", async () => {
    setBusy(true);
    try {
      setHint(authHintEl, "Signing up...", false);
      const tokenObj = await postJson(`${API_BASE}/auth/signup`, {
        email: emailEl.value,
        password: passwordEl.value,
      });
      setToken(tokenObj.token);
      setHint(authHintEl, `Signed in as ${tokenObj.user?.email || "user"}.`, false);
    } catch (e) {
      setHint(authHintEl, e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });

  loginBtn.addEventListener("click", async () => {
    setBusy(true);
    try {
      setHint(authHintEl, "Logging in...", false);
      const tokenObj = await postJson(`${API_BASE}/auth/login`, {
        email: emailEl.value,
        password: passwordEl.value,
      });
      setToken(tokenObj.token);
      setHint(authHintEl, `Welcome back ${tokenObj.user?.email || ""}`.trim(), false);
    } catch (e) {
      setHint(authHintEl, e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });

  askBtn.addEventListener("click", async () => {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      setHint(statusEl, "Please enter a prompt.", true);
      return;
    }

    setBusy(true);
    try {
      setHint(statusEl, "Requesting AI...", false);
      responseEl.textContent = "";
      const sessionId = ensureSessionId();
      const json = await postJson(
        `${API_BASE}/ask`,
        { prompt, useCache: true, sessionId, save: true },
        { token: getToken() }
      );
      const parts = [];
      if (json.cached) parts.push("cached");
      if (json.fallback) parts.push("fallback");
      const meta = parts.length ? ` (${parts.join(", ")})` : "";
      const latency = json.latencyMs != null ? ` - ${json.latencyMs}ms` : "";
      setHint(statusEl, `Done${meta}${latency}`, false);
      responseEl.textContent = json.response || "";
    } catch (e) {
      setHint(statusEl, e.message || String(e), true);
      responseEl.textContent = "";
    } finally {
      setBusy(false);
    }
  });

  clearBtn.addEventListener("click", () => {
    promptEl.value = "";
    responseEl.textContent = "";
    setHint(statusEl, "", false);
  });

  downloadBtn.addEventListener("click", async () => {
    setBusy(true);
    try {
      const sessionId = (sessionIdEl?.value || "").trim();
      if (!sessionId) {
        setHint(statusEl, "Enter a Session ID first.", true);
        return;
      }

      setHint(statusEl, "Downloading saved results...", false);
      const r = await fetch(`${API_BASE}/history?sessionId=${encodeURIComponent(sessionId)}&limit=50`);
      const json = await r.json().catch(() => ({}));
      if (!r.ok || !json.ok) throw new Error(json?.error || `History download failed (${r.status})`);

      const payload = {
        sessionId,
        downloadedAt: new Date().toISOString(),
        items: json.items || [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sessionResults-${sessionId}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setHint(statusEl, `Downloaded ${payload.items.length} saved item(s).`, false);
    } catch (e) {
      setHint(statusEl, e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
});

