const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

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

async function init() {
  const res = await api.runtime.sendMessage({ type: "GET_SETTINGS" }).catch(() => null);
  const s = res?.settings ?? {};
  $("instant").checked = !!s.instantMode;
  $("reverse").checked = !!s.defaultReverse;
  $("instant").addEventListener("change", () =>
    api.runtime.sendMessage({ type: "SET_SETTINGS", patch: { instantMode: $("instant").checked } }));
  $("reverse").addEventListener("change", () =>
    api.runtime.sendMessage({ type: "SET_SETTINGS", patch: { defaultReverse: $("reverse").checked } }));
  $("retry").addEventListener("click", check);
  check();
}
init();
