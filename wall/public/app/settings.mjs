export const TILL_KEY = "kennko-wall-till";
export const SFX_KEY = "kennko-wall-sfx";

export function loadTillAddress() {
  try { return localStorage.getItem(TILL_KEY) || ""; } catch { return ""; }
}

export function saveTillAddress(url) {
  try {
    if (!url) localStorage.removeItem(TILL_KEY);
    else localStorage.setItem(TILL_KEY, url);
  } catch { /* ignore */ }
}

export function loadSfxEnabled() {
  try { return localStorage.getItem(SFX_KEY) !== "false"; } catch { return true; }
}

export function saveSfxEnabled(on) {
  try { localStorage.setItem(SFX_KEY, on ? "true" : "false"); } catch { /* ignore */ }
}

export function openSettings({ version = "0.0.1", onRetry = () => {}, onSfxChange = () => {}, onCheckUpdate = null } = {}) {
  if (document.getElementById("kennko-wall-settings")) return;

  const overlay = document.createElement("div");
  overlay.id = "kennko-wall-settings";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(13,27,61,0.85);display:grid;place-items:center;z-index:9999;font-family:system-ui,sans-serif;color:#121212;";

  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border-radius:18px;padding:24px;width:min(460px,90vw);display:flex;flex-direction:column;gap:14px;border:3px solid #121212;";

  const title = document.createElement("h2");
  title.textContent = "Kennko Wall Settings";
  title.style.margin = "0";
  card.appendChild(title);

  const addrLabel = document.createElement("label");
  addrLabel.textContent = "Till address (manual fallback)";
  addrLabel.style.cssText = "display:flex;flex-direction:column;gap:6px;font-weight:700;";
  const addrInput = document.createElement("input");
  addrInput.type = "text";
  addrInput.placeholder = "http://192.168.1.50:4466";
  addrInput.value = loadTillAddress();
  addrInput.style.cssText = "padding:10px;border:2px solid #121212;border-radius:8px;font-size:16px;";
  addrLabel.appendChild(addrInput);
  card.appendChild(addrLabel);

  const sfxRow = document.createElement("button");
  sfxRow.type = "button";
  let sfxOn = loadSfxEnabled();
  const updateSfxLabel = () => { sfxRow.textContent = `Sound effects: ${sfxOn ? "On" : "Off"}`; };
  updateSfxLabel();
  sfxRow.style.cssText = "padding:10px 14px;border-radius:8px;border:2px solid #121212;background:#f3f4f6;font-size:16px;font-weight:700;text-align:left;cursor:pointer;";
  sfxRow.onclick = () => {
    sfxOn = !sfxOn;
    saveSfxEnabled(sfxOn);
    onSfxChange(sfxOn);
    updateSfxLabel();
  };
  card.appendChild(sfxRow);

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.textContent = "Look for the till again";
  retryBtn.style.cssText = "padding:10px 14px;border-radius:8px;border:0;background:#0055FF;color:#fff;font-size:16px;font-weight:700;cursor:pointer;";
  retryBtn.onclick = () => {
    saveTillAddress(addrInput.value.trim());
    onRetry();
    overlay.remove();
  };
  card.appendChild(retryBtn);

  if (onCheckUpdate) {
    const updBtn = document.createElement("button");
    updBtn.type = "button";
    updBtn.textContent = "Check for update";
    updBtn.style.cssText = "padding:10px 14px;border-radius:8px;border:2px solid #121212;background:#FFB830;color:#121212;font-size:16px;font-weight:700;cursor:pointer;";
    updBtn.onclick = () => onCheckUpdate(updBtn);
    card.appendChild(updBtn);
  }

  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:4px;";
  const ver = document.createElement("span");
  ver.textContent = `Version ${version}`;
  ver.style.cssText = "font-size:13px;color:#555;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Save & Close";
  closeBtn.style.cssText = "padding:8px 16px;border-radius:8px;border:2px solid #121212;background:#fff;font-weight:700;cursor:pointer;";
  closeBtn.onclick = () => {
    saveTillAddress(addrInput.value.trim());
    overlay.remove();
  };
  foot.append(ver, closeBtn);
  card.appendChild(foot);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  addrInput.focus();

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Back") overlay.remove();
  });
}

export function wireSettingsShortcut(opts) {
  let enterStart = 0;
  addEventListener("keydown", (e) => {
    if (e.key === "ContextMenu") {
      e.preventDefault();
      openSettings(opts);
    } else if (e.key === "Enter") {
      if (!e.repeat) enterStart = Date.now();
      else if (enterStart && Date.now() - enterStart >= 3000) {
        enterStart = 0;
        openSettings(opts);
      }
    }
  });
  addEventListener("keyup", (e) => {
    if (e.key === "Enter") enterStart = 0;
  });
}
