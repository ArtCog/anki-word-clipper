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
  '"forms" — for verbs ONLY, the Stammformen "Infinitiv, Präteritum, Partizip II with auxiliary", ' +
  "ALWAYS with 3rd-person-singular Präsens in brackets after the infinitive: " +
  '"sprechen (spricht), sprach, hat gesprochen", "gehen (geht), ging, ist gegangen"; ' +
  'English irregular verbs: "go, went, gone"; ' +
  "empty string for everything that is not a verb. Forms must be dictionary-accurate. " +
  '"translation" — concise translation into the target language, the meaning IN THIS CONTEXT ' +
  "(use the wider context, when given, to disambiguate — never translate the word in isolation). " +
  '"note" — very short human-readable grammar hint written in the TARGET language ' +
  '(e.g. "гл., отделяемая приставка", "прил.", "модальный глагол"); no dictionary codes like "m, -(e)s, -e"; ' +
  "for nouns do NOT repeat gender/article/plural — they are already in headword; " +
  "for verbs include Rektion (preposition + case) when notable; " +
  'when helpful append 1–2 simpler synonyms in the SOURCE language (e.g. "≈ verbessern, stärken"); may be empty. ' +
  "Keep it compact. Never add commentary.";

// opts: {baseUrl, model, apiKey, word, context, targetLang, extra, wantExample, wide, level, avoid}
function buildAiRequest(opts) {
  const base = String(opts.baseUrl).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  const key = String(opts.apiKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  let sys = AI_SYSTEM_PROMPT;
  if (opts.wantExample) {
    sys += ' Also include key "example" — one short, simple example sentence in the SOURCE language using the headword; it must differ from the given sentence.';
  }
  const extra = String(opts.extra ?? "").trim();
  if (extra) sys += `\nAdditional user instructions (they win over the defaults above): ${extra}`;

  const wide = String(opts.wide ?? "").trim();
  const level = String(opts.level ?? "").trim();
  const avoid = String(opts.avoid ?? "").trim();
  const userMsg =
    `Target language: ${opts.targetLang}\n` +
    (level ? `Learner level: ${level} — adapt translation nuance, synonyms, note and example to this level.\n` : "") +
    `Word or phrase: ${opts.word}\n` +
    (opts.context ? `Sentence: ${opts.context}` : "Sentence: (none)") +
    (wide && wide !== opts.context ? `\nWider context: ${wide}` : "") +
    (avoid ? `\nThe previous translation was rejected by the user — give a better or alternative one, not: ${avoid}` : "");

  return {
    url: `${base}/chat/completions`,
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        temperature: avoid ? 0.7 : 0,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
      }),
    },
  };
}

function extractJsonObject(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseAiResponse(json) {
  const obj = extractJsonObject(json);
  if (!obj) return null;
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

// ---------- batch mode: pick learnable words from a whole passage ----------

const AI_BATCH_PROMPT =
  "You are a language-learning assistant. From the given TEXT pick the 3–6 words or " +
  "expressions MOST worth learning for a learner at the given level (skip everything " +
  "the learner surely knows). Return STRICT JSON (no prose, no code fence): " +
  '{"items":[{"word":"exactly as it appears in the text",' +
  '"headword":"dictionary form (German nouns: article + plural)",' +
  '"forms":"verb Stammformen with 3rd-person Präsens in brackets, as in \\"gehen (geht), ging, ist gegangen\\"; empty if not a verb",' +
  '"translation":"into the target language, contextual",' +
  '"note":"very short hint in the target language, may be empty"}]}';

// opts: {baseUrl, model, apiKey, text, targetLang, level, extra}
function buildBatchRequest(opts) {
  const base = String(opts.baseUrl).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  const key = String(opts.apiKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  let sys = AI_BATCH_PROMPT;
  const extra = String(opts.extra ?? "").trim();
  if (extra) sys += `\nAdditional user instructions: ${extra}`;
  const level = String(opts.level ?? "").trim() || "B1";
  const userMsg =
    `Target language: ${opts.targetLang}\nLearner level: ${level}\nTEXT:\n${opts.text}`;
  return {
    url: `${base}/chat/completions`,
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
      }),
    },
  };
}

function parseBatchResponse(json) {
  const obj = extractJsonObject(json);
  if (!obj || !Array.isArray(obj.items)) return null;
  const items = obj.items
    .map((it) => ({
      word: String(it?.word ?? "").trim(),
      headword: String(it?.headword ?? "").trim(),
      forms: String(it?.forms ?? "").trim(),
      translation: String(it?.translation ?? "").trim(),
      note: String(it?.note ?? "").trim(),
    }))
    .filter((it) => it.word && it.translation)
    .slice(0, 8);
  return items.length ? items : null;
}

const Translator = {
  buildGoogleUrl, parseGoogleResponse, buildDeepLRequest, parseDeepLResponse,
  buildAiRequest, parseAiResponse, buildBatchRequest, parseBatchResponse,
};
if (typeof module !== "undefined" && module.exports) module.exports = Translator;
