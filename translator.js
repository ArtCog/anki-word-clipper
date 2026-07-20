// Translation providers: URL/request builders and response parsers (pure,
// unit-tested). background.js owns the actual fetch calls.
const GOOGLE_URL = "https://translate.googleapis.com/translate_a/single";

function buildGoogleUrl(text, targetLang) {
  const p = new URLSearchParams({ client: "gtx", sl: "auto", tl: targetLang, dt: "t", q: text });
  return `${GOOGLE_URL}?${p}`;
}

function parseGoogleResponse(json) {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const out = json[0].map((seg) => seg?.[0] ?? "").join("").trim();
  return out || null;
}

function buildDeepLRequest(text, targetLang, apiKey) {
  const key = String(apiKey).trim();
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  return {
    url: `${host}/v2/translate`,
    options: {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [text], target_lang: targetLang.toUpperCase() }),
    },
  };
}

function parseDeepLResponse(json) {
  const out = json?.translations?.[0]?.text?.trim();
  return out || null;
}

// ---------- AI provider (OpenAI-compatible chat/completions) ----------
// Works with OpenRouter, Google Gemini (OpenAI-compat endpoint), OpenAI and
// local Ollama — all speak the same /chat/completions shape.

const AI_SYSTEM_PROMPT =
  "You are a bilingual dictionary for language learners. Given a WORD or PHRASE as it " +
  "appears in a sentence, return STRICT JSON (no prose, no code fence) with keys: " +
  '"headword" — the dictionary form: ' +
  'German nouns → article + plural (e.g. "das Haus, die Häuser"); ' +
  "other words → plain base form; empty string if not applicable. " +
  '"forms" — for verbs ONLY, the Stammformen "Infinitiv, Präteritum, Partizip II with auxiliary": ' +
  'e.g. "gehen, ging, ist gegangen"; if 3rd-person-singular Präsens is irregular, add it in brackets ' +
  'after the infinitive: "sprechen (spricht), sprach, hat gesprochen"; English irregular verbs: "go, went, gone"; ' +
  "empty string for everything that is not a verb. Forms must be dictionary-accurate. " +
  '"translation" — concise translation into the target language, the meaning IN THIS CONTEXT. ' +
  '"note" — very short human-readable grammar hint written in the TARGET language ' +
  '(e.g. "гл., отделяемая приставка", "прил.", "модальный глагол"); no dictionary codes like "m, -(e)s, -e"; ' +
  "for nouns do NOT repeat gender/article/plural — they are already in headword; " +
  'when helpful append 1–2 simpler synonyms in the SOURCE language (e.g. "≈ verbessern, stärken"); may be empty. ' +
  "Keep it compact. Never add commentary.";

function buildAiRequest(baseUrl, model, apiKey, word, context, targetLang, extraInstructions, wantExample) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  const key = String(apiKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  let sys = AI_SYSTEM_PROMPT;
  if (wantExample) {
    sys += ' Also include key "example" — one short, simple (A2–B1 level) example sentence in the SOURCE language using the headword; it must differ from the given sentence.';
  }
  const extra = String(extraInstructions ?? "").trim();
  if (extra) sys += `\nAdditional user instructions (they win over the defaults above): ${extra}`;
  const userMsg =
    `Target language: ${targetLang}\nWord or phrase: ${word}\n` +
    (context ? `Sentence: ${context}` : "Sentence: (none)");
  return {
    url: `${base}/chat/completions`,
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
      }),
    },
  };
}

function parseAiResponse(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const translation = String(obj.translation ?? "").trim();
  if (!translation) return null;
  return {
    headword: String(obj.headword ?? "").trim() || null,
    forms: String(obj.forms ?? "").trim() || null,
    translation,
    note: String(obj.note ?? "").trim() || null,
    example: String(obj.example ?? "").trim() || null,
  };
}

const Translator = {
  buildGoogleUrl, parseGoogleResponse, buildDeepLRequest, parseDeepLResponse,
  buildAiRequest, parseAiResponse,
};
if (typeof module !== "undefined" && module.exports) module.exports = Translator;
