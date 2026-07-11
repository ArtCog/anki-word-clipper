// All AnkiConnect HTTP + settings live here. Chrome runs this as a service
// worker (importScripts below); Firefox loads manifest background.scripts
// ["anki-client.js", "background.js"] in order, so AnkiClient already exists.
if (typeof importScripts === "function") importScripts("anki-client.js", "translator.js");

const api = globalThis.browser ?? globalThis.chrome;
const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_SETTINGS = {
  lastDeck: null, instantMode: false,
  defaultCardType: "basic",           // "basic" | "reverse" | "cloze"
  autoTranslate: true, targetLang: "ru",
  engine: "google",                   // "google" | "deepl" | "ai" — сhosen translation engine
  deeplKey: "",
  aiBaseUrl: "", aiModel: "", aiKey: "", aiExtra: "",
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
  } else {
    // migration: older installs lack the Forms field
    const fields = await ankiFetch("modelFieldNames", { modelName: AnkiClient.MODEL_NAME });
    const addForms = !fields.includes("Forms");
    if (addForms) {
      await ankiFetch("modelFieldAdd", { modelName: AnkiClient.MODEL_NAME, fieldName: "Forms" });
    }
    if (addForms || s.modelTtsLang !== s.ttsLang) {
      await ankiFetch("updateModelTemplates", { model: { name: def.modelName, templates: templatesObj(def) } });
      await patchSettings({ modelTtsLang: s.ttsLang });
    }
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
  const stored = st.settings ?? {};
  const s = { ...DEFAULT_SETTINGS, ...stored };
  // migration from pre-"engine" settings (aiEnabled / bare deeplKey)
  if (!("engine" in stored)) {
    s.engine = stored.aiEnabled ? "ai" : (stored.deeplKey?.trim() ? "deepl" : "google");
  }
  return s;
}

// Serialized read-modify-write: concurrent patches (popup preset writes two
// fields back-to-back) must not overwrite each other.
let settingsQueue = Promise.resolve();
function patchSettings(patch) {
  settingsQueue = settingsQueue.then(async () => {
    const s = await getSettings();
    await api.storage.local.set({ settings: { ...s, ...patch } });
  });
  return settingsQueue;
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

const aiConfigured = (s) => s.aiBaseUrl?.trim() && s.aiModel?.trim();

// AI provider: context-aware. Returns dictionary headword + contextual
// translation + short grammar note. Never throws — failures bubble up so the
// caller can fall back to a plain translator.
async function aiTranslate(s, text, context) {
  const req = Translator.buildAiRequest(s.aiBaseUrl, s.aiModel, s.aiKey, text, context ?? "", s.targetLang, s.aiExtra);
  const res = await fetchWithTimeout(req.url, req.options, 20000);
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const out = Translator.parseAiResponse(await res.json());
  if (!out) throw new Error("AI: пустой/некорректный ответ");
  return { ok: true, provider: "ai", ...out }; // {translation, headword, note}
}

async function deeplTranslate(s, text) {
  const req = Translator.buildDeepLRequest(text, s.targetLang, s.deeplKey);
  const res = await fetchWithTimeout(req.url, req.options);
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  const t = Translator.parseDeepLResponse(await res.json());
  if (!t) throw new Error("DeepL: пустой ответ");
  return { ok: true, translation: t, provider: "deepl" };
}

async function googleTranslate(s, text) {
  const res = await fetchWithTimeout(Translator.buildGoogleUrl(text, s.targetLang));
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const t = Translator.parseGoogleResponse(await res.json());
  if (!t) throw new Error("Google: пустой ответ");
  return { ok: true, translation: t, provider: "google" };
}

// Translation is a convenience: any failure returns ok:false and the caller
// proceeds with an empty translation instead of blocking the card.
// Engine hierarchy: the chosen engine runs first; Google is the safety net.
async function translate(text, context) {
  const s = await getSettings();
  if (!s.autoTranslate || !text?.trim()) return { ok: false, code: "DISABLED", message: "" };
  // fall back to Google when the chosen engine can't answer — but tell the
  // user WHY, otherwise a misconfigured AI silently looks like "no forms"
  let fallbackError = null;
  if (s.engine === "ai" && !aiConfigured(s)) {
    fallbackError = "ИИ не настроен — открой попап расширения";
  } else if (s.engine === "deepl" && !s.deeplKey?.trim()) {
    fallbackError = "нет DeepL-ключа — открой попап расширения";
  } else {
    try {
      if (s.engine === "ai") return await aiTranslate(s, text, context);
      if (s.engine === "deepl") return await deeplTranslate(s, text);
    } catch (e) {
      fallbackError = String(e?.message ?? e);
    }
  }
  try {
    const r = await googleTranslate(s, text);
    if (fallbackError) {
      r.fallbackFrom = s.engine;
      r.fallbackError = fallbackError;
    }
    return r;
  } catch (e) {
    return { ok: false, code: "TRANSLATE_FAILED", message: String(e?.message ?? e) };
  }
}

// Popup "Проверить AI" button: surface the real error to the user.
async function testAi() {
  const s = await getSettings();
  if (!s.aiBaseUrl?.trim() || !s.aiModel?.trim()) {
    return { ok: false, message: "Выбери провайдера из списка — URL и модель заполнятся сами." };
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(s.aiBaseUrl);
  if (!s.aiKey?.trim() && !isLocal) {
    return { ok: false, message: "Вставь API-ключ (ссылка «Получить ключ» под полем)." };
  }
  try {
    const r = await aiTranslate(s, "Haus", "Das Haus ist groß.");
    return { ok: true, sample: r };
  } catch (e) {
    const m = String(e?.message ?? e);
    const status = m.match(/HTTP (\d+)/)?.[1];
    if (status === "401" || status === "403") return { ok: false, message: "Провайдер не принял ключ — проверь его (или получи новый)." };
    if (status === "404") return { ok: false, message: "Модель не найдена — проверь её имя у провайдера." };
    if (status === "429") return { ok: false, message: "Лимит запросов провайдера — подожди минуту и повтори." };
    return { ok: false, message: m };
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
