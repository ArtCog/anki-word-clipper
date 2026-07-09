const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const set = (patch) => api.runtime.sendMessage({ type: "SET_SETTINGS", patch });

// preset → base URL + a sensible default model (user can override)
const AI_PRESETS = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.5-flash",
    keyUrl: "https://openrouter.ai/settings/keys",
  },
  openai: {
    url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  ollama: { url: "http://localhost:11434/v1", model: "llama3.1", keyUrl: null },
  custom: { url: "", model: "", keyUrl: null },
};

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

  $("deeplkey").value = s.deeplKey ?? "";
  $("aiurl").value = s.aiBaseUrl ?? "";
  $("aimodel").value = s.aiModel ?? "";
  $("aikey").value = s.aiKey ?? "";

  // restore preset selection + key link from the saved base URL
  const presetName = Object.keys(AI_PRESETS).find((k) => AI_PRESETS[k].url && AI_PRESETS[k].url === s.aiBaseUrl);
  if (presetName) {
    $("aipreset").value = presetName;
    const p = AI_PRESETS[presetName];
    if (p.keyUrl) { $("aikeylink").hidden = false; $("aikeylink").href = p.keyUrl; }
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
  });
  $("aiurl").addEventListener("change", () => set({ aiBaseUrl: $("aiurl").value.trim() }));
  $("aimodel").addEventListener("change", () => set({ aiModel: $("aimodel").value.trim() }));
  $("aikey").addEventListener("change", () => set({ aiKey: $("aikey").value.trim() }));
  $("aitest").addEventListener("click", testAi);

  $("retry").addEventListener("click", check);
  check();
}
init();
