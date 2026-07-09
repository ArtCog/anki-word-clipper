// All AnkiConnect HTTP + settings live here. Chrome runs this as a service
// worker (importScripts below); Firefox loads manifest background.scripts
// ["anki-client.js", "background.js"] in order, so AnkiClient already exists.
if (typeof importScripts === "function") importScripts("anki-client.js", "translator.js");

const api = globalThis.browser ?? globalThis.chrome;
const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_SETTINGS = {
  lastDeck: null, instantMode: false,
  defaultCardType: "basic",           // "basic" | "reverse" | "cloze"
  autoTranslate: true, targetLang: "ru", deeplKey: "",
  aiEnabled: false, aiBaseUrl: "", aiModel: "", aiKey: "",
  ttsLang: "off",                     // Anki tts lang tag: "off" | "de_DE" | "en_US" | …
  modelTtsLang: null,                 // internal: tts lang the main model was built with
};

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

// updateModelTemplates wants { "Template Name": {Front, Back}, … }
function templatesObj(def) {
  const o = {};
  for (const t of def.cardTemplates) o[t.Name] = { Front: t.Front, Back: t.Back };
  return o;
}

// Ensures both note types exist and keeps the main model's TTS templates in
// sync with the current setting (createModel only runs once; a later TTS
// change is applied via updateModelTemplates).
async function ensureModel() {
  const s = await getSettings();
  const names = await ankiFetch("modelNames");
  const def = AnkiClient.buildModelDef(s.ttsLang);
  if (!names.includes(AnkiClient.MODEL_NAME)) {
    await ankiFetch("createModel", def);
    await patchSettings({ modelTtsLang: s.ttsLang });
  } else if (s.modelTtsLang !== s.ttsLang) {
    await ankiFetch("updateModelTemplates", { model: { name: def.modelName, templates: templatesObj(def) } });
    await patchSettings({ modelTtsLang: s.ttsLang });
  }
  if (!names.includes(AnkiClient.CLOZE_MODEL_NAME)) {
    await ankiFetch("createModel", AnkiClient.buildClozeModelDef());
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

// note.cardType: "basic" | "reverse" | "cloze"
async function addNote(note) {
  if (!note?.word?.trim()) return { ok: false, code: "UNKNOWN", message: "Пустое слово" };
  if (!note.deck) return { ok: false, code: "DECK_MISSING", message: "Колода не выбрана" };
  const c = await check();
  if (!c.ok) return c;
  try {
    const req = note.cardType === "cloze"
      ? AnkiClient.buildClozeNoteRequest(note)
      : AnkiClient.buildAddNoteRequest({ ...note, reverse: note.cardType === "reverse" });
    await ankiFetch(req.action, req.params);
    await patchSettings({ lastDeck: note.deck });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code ?? "UNKNOWN", message: e.message ?? String(e) };
  }
}

async function fetchWithTimeout(url, options = {}, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const aiConfigured = (s) => s.aiEnabled && s.aiBaseUrl?.trim() && s.aiModel?.trim();

// AI provider: context-aware. Returns dictionary headword + contextual
// translation + short grammar note. Never throws — failures bubble up so the
// caller can fall back to a plain translator.
async function aiTranslate(s, text, context) {
  const req = Translator.buildAiRequest(s.aiBaseUrl, s.aiModel, s.aiKey, text, context ?? "", s.targetLang);
  const res = await fetchWithTimeout(req.url, req.options, 20000);
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const out = Translator.parseAiResponse(await res.json());
  if (!out) throw new Error("AI: пустой/некорректный ответ");
  return { ok: true, provider: "ai", ...out }; // {translation, headword, note}
}

async function plainTranslate(s, text) {
  if (s.deeplKey?.trim()) {
    const req = Translator.buildDeepLRequest(text, s.targetLang, s.deeplKey);
    const res = await fetchWithTimeout(req.url, req.options);
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
    const t = Translator.parseDeepLResponse(await res.json());
    if (!t) throw new Error("DeepL: пустой ответ");
    return { ok: true, translation: t, provider: "deepl" };
  }
  const res = await fetchWithTimeout(Translator.buildGoogleUrl(text, s.targetLang));
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const t = Translator.parseGoogleResponse(await res.json());
  if (!t) throw new Error("Google: пустой ответ");
  return { ok: true, translation: t, provider: "google" };
}

// Translation is a convenience: any failure returns ok:false and the caller
// proceeds with an empty translation instead of blocking the card.
async function translate(text, context) {
  const s = await getSettings();
  if (!s.autoTranslate || !text?.trim()) return { ok: false, code: "DISABLED", message: "" };
  if (aiConfigured(s)) {
    try {
      return await aiTranslate(s, text, context);
    } catch {
      // fall through to plain translator so the field still fills
    }
  }
  try {
    return await plainTranslate(s, text);
  } catch (e) {
    return { ok: false, code: "TRANSLATE_FAILED", message: String(e?.message ?? e) };
  }
}

// Popup "Проверить AI" button: surface the real error to the user.
async function testAi() {
  const s = await getSettings();
  if (!aiConfigured(s)) return { ok: false, message: "Укажи URL, модель и (если нужно) ключ." };
  try {
    const r = await aiTranslate(s, "Haus", "Das Haus ist groß.");
    return { ok: true, sample: r };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  }
}

async function handleMessage(msg) {
  switch (msg?.type) {
    case "CHECK_CONNECTION": return check();
    case "GET_DECKS": return getDecks();
    case "ADD_NOTE": return addNote(msg.note);
    case "TRANSLATE": return translate(msg.text, msg.context);
    case "TEST_AI": return testAi();
    case "GET_SETTINGS": return { ok: true, settings: await getSettings() };
    case "SET_SETTINGS":
      await patchSettings(msg.patch ?? {});
      if (msg.patch && "ttsLang" in msg.patch) modelReady = false; // re-sync templates
      return { ok: true };
    default: return { ok: false, code: "UNKNOWN", message: `Unknown message: ${msg?.type}` };
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, code: "UNKNOWN", message: String(e?.message ?? e) }));
  return true; // async sendResponse
});

api.runtime.onInstalled.addListener((details) => {
  api.contextMenus.create({ id: "wc-form", title: "Добавить в Anki…", contexts: ["selection"] });
  api.contextMenus.create({ id: "wc-instant", title: "Добавить в Anki мгновенно", contexts: ["selection"] });
  if (details.reason === "install") {
    api.tabs.create({ url: api.runtime.getURL("welcome.html") });
  }
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
      source: tab.title ?? "", cardType: s.defaultCardType,
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
