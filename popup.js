const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const set = (patch) => api.runtime.sendMessage({ type: "SET_SETTINGS", patch });

// preset → base URL + a sensible default model (user can override)
const AI_PRESETS = {
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  openrouter: { url: "https://openrouter.ai/api/v1", model: "google/gemini-2.0-flash-exp:free" },
  openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  ollama: { url: "http://localhost:11434/v1", model: "llama3.1" },
  custom: { url: "", model: "" },
};

async function check() {
  const box = $("status");
  box.className = "checking";
  box.textContent = "Проверяю соединение…";
  const res = await api.runtime.sendMessage({ type: "CHECK_CONNECTION" }).catch(() => null);
  const ok = !!res?.ok;
  box.className = ok ? "ok" : "err";
  box.textContent = ok ? "Anki подключён ✓" : (res?.message ?? "Anki недоступен");
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
  $("deeplkey").value = s.deeplKey ?? "";
  $("aienabled").checked = !!s.aiEnabled;
  $("aiurl").value = s.aiBaseUrl ?? "";
  $("aimodel").value = s.aiModel ?? "";
  $("aikey").value = s.aiKey ?? "";
  $("aibody").hidden = !s.aiEnabled;

  $("instant").addEventListener("change", () => set({ instantMode: $("instant").checked }));
  $("cardtype").addEventListener("change", () => set({ defaultCardType: $("cardtype").value }));
  $("ttslang").addEventListener("change", () => set({ ttsLang: $("ttslang").value }));
  $("autotr").addEventListener("change", () => set({ autoTranslate: $("autotr").checked }));
  $("deeplkey").addEventListener("change", () => set({ deeplKey: $("deeplkey").value.trim() }));

  $("aienabled").addEventListener("change", () => {
    $("aibody").hidden = !$("aienabled").checked;
    set({ aiEnabled: $("aienabled").checked });
  });
  $("aipreset").addEventListener("change", () => {
    const p = AI_PRESETS[$("aipreset").value];
    if (!p) return;
    if (p.url) { $("aiurl").value = p.url; set({ aiBaseUrl: p.url }); }
    if (p.model) { $("aimodel").value = p.model; set({ aiModel: p.model }); }
  });
  $("aiurl").addEventListener("change", () => set({ aiBaseUrl: $("aiurl").value.trim() }));
  $("aimodel").addEventListener("change", () => set({ aiModel: $("aimodel").value.trim() }));
  $("aikey").addEventListener("change", () => set({ aiKey: $("aikey").value.trim() }));
  $("aitest").addEventListener("click", testAi);

  $("retry").addEventListener("click", check);
  check();
}
init();
