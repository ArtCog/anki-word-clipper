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

const Translator = { buildGoogleUrl, parseGoogleResponse, buildDeepLRequest, parseDeepLResponse };
if (typeof module !== "undefined" && module.exports) module.exports = Translator;
