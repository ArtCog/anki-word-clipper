const { test } = require("node:test");
const assert = require("node:assert/strict");
const T = require("../translator.js");

test("buildGoogleUrl encodes text and target language", () => {
  const url = T.buildGoogleUrl("die Herausforderung", "ru");
  assert.ok(url.startsWith("https://translate.googleapis.com/translate_a/single?"));
  assert.ok(url.includes("client=gtx"));
  assert.ok(url.includes("tl=ru"));
  assert.ok(url.includes("q=die+Herausforderung"));
});

test("parseGoogleResponse joins translation segments", () => {
  const json = [[["вызов, ", "die Herausforderung", null], ["сложная задача", "x", null]], null, "de"];
  assert.equal(T.parseGoogleResponse(json), "вызов, сложная задача");
});

test("parseGoogleResponse returns null for garbage", () => {
  assert.equal(T.parseGoogleResponse(null), null);
  assert.equal(T.parseGoogleResponse({}), null);
  assert.equal(T.parseGoogleResponse([[]]), null);
});

test("buildDeepLRequest picks free host for :fx keys and uppercases lang", () => {
  const free = T.buildDeepLRequest("Haus", "ru", "abc123:fx");
  assert.equal(free.url, "https://api-free.deepl.com/v2/translate");
  assert.equal(free.options.headers.Authorization, "DeepL-Auth-Key abc123:fx");
  assert.deepEqual(JSON.parse(free.options.body), { text: ["Haus"], target_lang: "RU" });

  const pro = T.buildDeepLRequest("Haus", "ru", "abc123");
  assert.equal(pro.url, "https://api.deepl.com/v2/translate");
});

test("parseDeepLResponse extracts text or null", () => {
  assert.equal(T.parseDeepLResponse({ translations: [{ text: "дом" }] }), "дом");
  assert.equal(T.parseDeepLResponse({ translations: [] }), null);
  assert.equal(T.parseDeepLResponse(null), null);
});

test("buildAiRequest targets chat/completions with bearer key and both word and context", () => {
  const r = T.buildAiRequest("https://openrouter.ai/api/v1/", "google/gemini-2.5-flash", "sk-or-abc", "Häusern", "In den Häusern ist es warm.", "ru");
  assert.equal(r.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(r.options.headers.Authorization, "Bearer sk-or-abc");
  const body = JSON.parse(r.options.body);
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.equal(body.temperature, 0);
  const user = body.messages.find((m) => m.role === "user").content;
  assert.ok(user.includes("Häusern"));
  assert.ok(user.includes("In den Häusern ist es warm."));
});

test("buildAiRequest omits Authorization without key (Ollama)", () => {
  const r = T.buildAiRequest("http://localhost:11434/v1", "qwen3:8b", "", "Haus", "", "ru");
  assert.equal(r.options.headers.Authorization, undefined);
});

test("parseAiResponse parses plain and fenced JSON", () => {
  const wrap = (content) => ({ choices: [{ message: { content } }] });
  const plain = T.parseAiResponse(wrap('{"headword":"das Haus, die Häuser","translation":"дом","note":"n, сущ."}'));
  assert.deepEqual(plain, { headword: "das Haus, die Häuser", forms: null, translation: "дом", note: "n, сущ." });
  const fenced = T.parseAiResponse(wrap('```json\n{"headword":"","translation":"дом","note":""}\n```'));
  assert.equal(fenced.translation, "дом");
  assert.equal(fenced.headword, null);
  assert.equal(T.parseAiResponse(wrap("это не JSON")), null);
  assert.equal(T.parseAiResponse(wrap('{"headword":"x","note":"y"}')), null); // no translation
  assert.equal(T.parseAiResponse(null), null);
});

test("system prompt teaches verb principal forms; extra instructions are appended", () => {
  const r = T.buildAiRequest("https://x/v1", "m", "k", "ging", "Er ging heim.", "ru");
  const sys = JSON.parse(r.options.body).messages[0].content;
  assert.ok(sys.includes("gehen, ging, ist gegangen"));
  assert.ok(sys.includes("go, went, gone"));
  const r2 = T.buildAiRequest("https://x/v1", "m", "k", "w", "", "ru", "always add IPA");
  const sys2 = JSON.parse(r2.options.body).messages[0].content;
  assert.ok(sys2.includes("always add IPA"));
});

test("parseAiResponse passes verb forms through", () => {
  const wrap = (content) => ({ choices: [{ message: { content } }] });
  const r = T.parseAiResponse(wrap('{"headword":"verzögern","forms":"verzögern, verzögerte, hat verzögert","translation":"задерживать","note":"глагол"}'));
  assert.equal(r.forms, "verzögern, verzögerte, hat verzögert");
  assert.equal(T.parseAiResponse(wrap('{"translation":"дом"}')).forms, null);
});

test("example key: requested via flag, parsed from response", () => {
  const withEx = T.buildAiRequest("https://x/v1", "m", "k", "w", "", "ru", "", true);
  assert.ok(JSON.parse(withEx.options.body).messages[0].content.includes('"example"'));
  const without = T.buildAiRequest("https://x/v1", "m", "k", "w", "", "ru", "", false);
  assert.ok(!JSON.parse(without.options.body).messages[0].content.includes('"example"'));
  const wrap = (content) => ({ choices: [{ message: { content } }] });
  const r = T.parseAiResponse(wrap('{"translation":"дом","example":"Das Haus ist alt."}'));
  assert.equal(r.example, "Das Haus ist alt.");
});
