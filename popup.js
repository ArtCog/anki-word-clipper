const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const set = (patch) => api.runtime.sendMessage({ type: "SET_SETTINGS", patch });

// preset → base URL + a sensible default model (user can override)
const AI_PRESETS = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      ["gemini-3.6-flash", "Gemini 3.6 Flash — новее и умнее"],
      ["gemini-3.5-flash", "Gemini 3.5 Flash"],
      ["gemini-2.5-flash", "Gemini 2.5 Flash — проверено временем"],
      ["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite — самый щедрый лимит"],
      ["gemini-2.5-pro", "Gemini 2.5 Pro — медленнее, умнее"],
    ],
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.5-flash",
    keyUrl: "https://openrouter.ai/settings/keys",
    models: [
      ["google/gemini-2.5-flash", "Gemini 2.5 Flash"],
      ["anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5"],
      ["openai/gpt-4o-mini", "GPT-4o mini"],
    ],
  },
  openai: {
    url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      ["gpt-4o-mini", "GPT-4o mini — дёшево и быстро"],
      ["gpt-4o", "GPT-4o"],
    ],
  },
  bridge: {
    url: "http://localhost:8770/v1",
    model: "claude-haiku",
    keyUrl: null,
    models: [
      ["claude-haiku", "Claude Haiku (подписка Max) — 20 с"],
      ["claude-sonnet", "Claude Sonnet (подписка Max)"],
      ["claude-opus", "Claude Opus (подписка Max) — самый умный"],
      ["antigravity", "Antigravity через сервер — 40 с"],
      ["codex", "Codex (подписка ChatGPT) — 60 с"],
      ["gemini", "Gemini CLI"],
    ],
  },
  ollama: {
    url: "http://localhost:11434/v1",
    model: "llama3.1",
    keyUrl: null,
    models: [["llama3.1", "Llama 3.1"], ["qwen2.5", "Qwen 2.5"]],
  },
  custom: { url: "", model: "", keyUrl: null, models: [] },
};

const CUSTOM_MODEL = "__custom__";

// fill the model dropdown for a preset; keeps `selected` chosen if it is known,
// otherwise falls back to the free-text field
function fillModels(presetName, selected) {
  const sel = $("aimodelsel");
  const list = AI_PRESETS[presetName]?.models ?? [];
  sel.innerHTML = "";
  for (const [id, label] of list) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label;
    sel.append(o);
  }
  const other = document.createElement("option");
  other.value = CUSTOM_MODEL;
  other.textContent = "другая (вписать вручную)";
  sel.append(other);

  const known = list.some(([id]) => id === selected);
  sel.value = known ? selected : CUSTOM_MODEL;
  sel.parentElement.hidden = list.length === 0;
  $("aimodel").parentElement.hidden = list.length > 0 && known;
}

function showEngine(engine) {
  $("eng-deepl").hidden = engine !== "deepl";
  $("eng-ai").hidden = engine !== "ai";
}

async function check() {
  const box = $("status");
  box.className = "checking";
  box.textContent = "Проверяю соединение…";
  const res = await api.runtime.sendMessage({ type: "CHECK_CONNECTION" }).catch(() => null);
  const ok = !!res?.ok;
  box.className = ok ? "ok" : "err";
  box.textContent = ok ? "Anki подключён" : (res?.message ?? "Anki недоступен");
  $("help").hidden = ok;
}

async function testAi() {
  const out = $("aitest-res");
  out.className = "";
  out.textContent = "Проверяю ИИ…";
  const res = await api.runtime.sendMessage({ type: "TEST_AI" }).catch((e) => ({ ok: false, message: String(e) }));
  if (res?.ok) {
    out.className = "ok";
    const s = res.sample;
    out.textContent = `✓ ${s.headword || "Haus"} — ${s.translation}${s.note ? " · " + s.note : ""}`;
  } else {
    out.className = "err";
    out.textContent = `✗ ${res?.message ?? "не удалось"}`;
  }
}

async function init() {
  const res = await api.runtime.sendMessage({ type: "GET_SETTINGS" }).catch(() => null);
  const s = res?.settings ?? {};

  $("instant").checked = !!s.instantMode;
  $("cardtype").value = s.defaultCardType ?? "basic";
  $("ttslang").value = s.ttsLang ?? "off";

  $("autotr").checked = s.autoTranslate !== false;
  $("engines").hidden = !$("autotr").checked;
  $("engine").value = s.engine ?? "google";
  showEngine($("engine").value);
  $("targetlang").value = s.targetLang ?? "ru";
  $("level").value = s.level ?? "";

  $("deeplkey").value = s.deeplKey ?? "";
  $("aiurl").value = s.aiBaseUrl ?? "";
  $("aimodel").value = s.aiModel ?? "";
  $("aikey").value = s.aiKey ?? "";
  $("aiextra").value = s.aiExtra ?? "";
  $("aiexample").checked = !!s.aiExample;

  // restore preset selection + key link from the saved base URL
  const presetName = Object.keys(AI_PRESETS).find((k) => AI_PRESETS[k].url && AI_PRESETS[k].url === s.aiBaseUrl);
  if (presetName) {
    $("aipreset").value = presetName;
    const p = AI_PRESETS[presetName];
    if (p.keyUrl) { $("aikeylink").hidden = false; $("aikeylink").href = p.keyUrl; }
    $("bridgehint").hidden = presetName !== "bridge";
    fillModels(presetName, s.aiModel ?? "");
  } else {
    fillModels("custom", s.aiModel ?? "");
  }

  $("instant").addEventListener("change", () => set({ instantMode: $("instant").checked }));
  $("cardtype").addEventListener("change", () => set({ defaultCardType: $("cardtype").value }));
  $("ttslang").addEventListener("change", () => set({ ttsLang: $("ttslang").value }));

  $("autotr").addEventListener("change", () => {
    $("engines").hidden = !$("autotr").checked;
    set({ autoTranslate: $("autotr").checked });
  });
  $("engine").addEventListener("change", () => {
    showEngine($("engine").value);
    set({ engine: $("engine").value });
  });
  $("targetlang").addEventListener("change", () => set({ targetLang: $("targetlang").value }));
  $("level").addEventListener("change", () => set({ level: $("level").value }));

  $("deeplkey").addEventListener("change", () => set({ deeplKey: $("deeplkey").value.trim() }));
  $("aipreset").addEventListener("change", () => {
    const p = AI_PRESETS[$("aipreset").value];
    if (!p) return;
    $("aiurl").value = p.url;
    $("aimodel").value = p.model;
    set({ aiBaseUrl: p.url, aiModel: p.model }); // one atomic patch — no lost update
    const link = $("aikeylink");
    link.hidden = !p.keyUrl;
    if (p.keyUrl) { link.href = p.keyUrl; $("aikey").focus(); }
    $("bridgehint").hidden = $("aipreset").value !== "bridge";
    fillModels($("aipreset").value, p.model);
  });
  $("aiurl").addEventListener("change", () => set({ aiBaseUrl: $("aiurl").value.trim() }));
  $("aimodelsel").addEventListener("change", () => {
    const v = $("aimodelsel").value;
    const manual = v === CUSTOM_MODEL;
    $("aimodel").parentElement.hidden = !manual;
    if (manual) $("aimodel").focus();
    else { $("aimodel").value = v; set({ aiModel: v }); }
  });
  $("aimodel").addEventListener("change", () => set({ aiModel: $("aimodel").value.trim() }));
  $("aikey").addEventListener("change", () => set({ aiKey: $("aikey").value.trim() }));
  $("aiextra").addEventListener("change", () => set({ aiExtra: $("aiextra").value.trim() }));
  $("aiexample").addEventListener("change", () => set({ aiExample: $("aiexample").checked }));
  $("aitest").addEventListener("click", testAi);

  $("retry").addEventListener("click", check);
  check();
}
init();
