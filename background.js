// All AnkiConnect HTTP + settings live here. Chrome runs this as a service
// worker (importScripts below); Firefox loads manifest background.scripts
// ["anki-client.js", "background.js"] in order, so AnkiClient already exists.
if (typeof importScripts === "function") importScripts("anki-client.js");

const api = globalThis.browser ?? globalThis.chrome;
const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_SETTINGS = { lastDeck: null, instantMode: false, defaultReverse: false };

let modelReady = false;

async function ankiFetch(action, params = {}) {
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    res = await fetch(ANKI_URL, {
      method: "POST",
      body: JSON.stringify({ action, version: 6, params }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch {
    throw {
      code: "ANKI_UNREACHABLE",
      message: "Anki недоступен. Запусти Anki (с аддоном AnkiConnect) и попробуй снова.",
    };
  }
  const out = AnkiClient.interpretResponse(await res.json().catch(() => null));
  if (!out.ok) throw out;
  return out.result;
}

async function ensureModel() {
  const names = await ankiFetch("modelNames");
  if (!names.includes(AnkiClient.MODEL_NAME)) {
    await ankiFetch("createModel", AnkiClient.MODEL_DEF);
  }
}

// requestPermission is the only action AnkiConnect answers for unknown
// origins; on first call Anki shows a dialog the user must accept.
async function check() {
  try {
    const perm = await ankiFetch("requestPermission");
    if (perm.permission !== "granted") {
      modelReady = false;
      return { ok: false, code: "PERMISSION_DENIED", message: "Anki не разрешил доступ. Нажми «Yes» в окне Anki и повтори." };
    }
    if (!modelReady) {
      await ensureModel();
      modelReady = true;
    }
    return { ok: true };
  } catch (e) {
    modelReady = false;
    return { ok: false, code: e.code ?? "UNKNOWN", message: e.message ?? String(e) };
  }
}

async function getSettings() {
  const st = await api.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(st.settings ?? {}) };
}

async function patchSettings(patch) {
  const s = await getSettings();
  await api.storage.local.set({ settings: { ...s, ...patch } });
}

async function getDecks() {
  const c = await check();
  if (!c.ok) return c;
  try {
    const decks = await ankiFetch("deckNames");
    const s = await getSettings();
    return { ok: true, decks, lastDeck: s.lastDeck };
  } catch (e) {
    return { ok: false, code: e.code ?? "UNKNOWN", message: e.message ?? String(e) };
  }
}

async function addNote(note) {
  if (!note?.word?.trim()) return { ok: false, code: "UNKNOWN", message: "Пустое слово" };
  if (!note.deck) return { ok: false, code: "DECK_MISSING", message: "Колода не выбрана" };
  const c = await check();
  if (!c.ok) return c;
  try {
    const req = AnkiClient.buildAddNoteRequest(note);
    await ankiFetch(req.action, req.params);
    await patchSettings({ lastDeck: note.deck });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code ?? "UNKNOWN", message: e.message ?? String(e) };
  }
}

async function handleMessage(msg) {
  switch (msg?.type) {
    case "CHECK_CONNECTION": return check();
    case "GET_DECKS": return getDecks();
    case "ADD_NOTE": return addNote(msg.note);
    case "GET_SETTINGS": return { ok: true, settings: await getSettings() };
    case "SET_SETTINGS": await patchSettings(msg.patch ?? {}); return { ok: true };
    default: return { ok: false, code: "UNKNOWN", message: `Unknown message: ${msg?.type}` };
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, code: "UNKNOWN", message: String(e?.message ?? e) }));
  return true; // async sendResponse
});

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: "wc-form", title: "Добавить в Anki…", contexts: ["selection"] });
  api.contextMenus.create({ id: "wc-instant", title: "Добавить в Anki мгновенно", contexts: ["selection"] });
});

function flashBadge(text) {
  api.action.setBadgeBackgroundColor({ color: "#0B0F0E" });
  api.action.setBadgeText({ text });
  setTimeout(() => api.action.setBadgeText({ text: "" }), 2000);
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const type = info.menuItemId === "wc-form" ? "OPEN_FORM" : "INSTANT_ADD";
  if (!tab?.id) return;
  try {
    await api.tabs.sendMessage(tab.id, { type });
  } catch {
    // No content script here (PDF viewer etc.) — degrade to context-less instant add.
    if (!info.selectionText) return;
    const s = await getSettings();
    if (!s.lastDeck) { flashBadge("!"); return; }
    const res = await addNote({
      word: info.selectionText, translation: "", context: "",
      source: tab.title ?? "", reverse: s.defaultReverse,
      deck: s.lastDeck, allowDuplicate: false,
    });
    flashBadge(res.ok ? "✓" : "!");
  }
});

api.commands?.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-clipper-form") return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) api.tabs.sendMessage(tab.id, { type: "OPEN_FORM" }).catch(() => {});
});
