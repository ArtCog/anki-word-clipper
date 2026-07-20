const { test } = require("node:test");
const assert = require("node:assert/strict");
const T = require("../translator.js");

const wrap = (content) => ({ choices: [{ message: { content } }] });
const ai = (over = {}) =>
  T.buildAiRequest({
    baseUrl: "https://x/v1", model: "m", apiKey: "k",
    word: "w", context: "", targetLang: "ru",
    ...over,
  });
const userOf = (r) => JSON.parse(r.options.body).messages.find((m) => m.role === "user").content;
const sysOf = (r) => JSON.parse(r.options.body).messages[0].content;

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
  const r = ai({ baseUrl: "https://openrouter.ai/api/v1/", model: "google/gemini-2.5-flash", apiKey: "sk-or-abc", word: "Häusern", context: "In den Häusern ist es warm." });
  assert.equal(r.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(r.options.headers.Authorization, "Bearer sk-or-abc");
  const body = JSON.parse(r.options.body);
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.equal(body.temperature, 0);
  assert.ok(userOf(r).includes("Häusern"));
  assert.ok(userOf(r).includes("In den Häusern ist es warm."));
});

test("buildAiRequest omits Authorization without key (Ollama)", () => {
  const r = ai({ baseUrl: "http://localhost:11434/v1", model: "qwen3:8b", apiKey: "" });
  assert.equal(r.options.headers.Authorization, undefined);
});

test("parseAiResponse parses plain and fenced JSON", () => {
  const plain = T.parseAiResponse(wrap('{"headword":"das Haus, die Häuser","translation":"дом","note":"n, сущ."}'));
  assert.deepEqual(plain, { headword: "das Haus, die Häuser", forms: null, translation: "дом", note: "n, сущ.", example: null });
  const fenced = T.parseAiResponse(wrap('```json\n{"headword":"","translation":"дом","note":""}\n```'));
  assert.equal(fenced.translation, "дом");
  assert.equal(fenced.headword, null);
  assert.equal(T.parseAiResponse(wrap("это не JSON")), null);
  assert.equal(T.parseAiResponse(wrap('{"headword":"x","note":"y"}')), null); // no translation
  assert.equal(T.parseAiResponse(null), null);
});

test("system prompt teaches verb principal forms; extra instructions are appended", () => {
  const sys = sysOf(ai({ word: "ging", context: "Er ging heim." }));
  assert.ok(sys.includes("sprechen (spricht), sprach, hat gesprochen"));
  assert.ok(sys.includes("go, went, gone"));
  assert.ok(sys.includes("Rektion"));
  const sys2 = sysOf(ai({ extra: "always add IPA" }));
  assert.ok(sys2.includes("always add IPA"));
});

test("parseAiResponse passes verb forms through", () => {
  const r = T.parseAiResponse(wrap('{"headword":"verzögern","forms":"verzögern, verzögerte, hat verzögert","translation":"задерживать","note":"глагол"}'));
  assert.equal(r.forms, "verzögern, verzögerte, hat verzögert");
  assert.equal(T.parseAiResponse(wrap('{"translation":"дом"}')).forms, null);
});

test("example key: requested via flag, parsed from response", () => {
  assert.ok(sysOf(ai({ wantExample: true })).includes('"example"'));
  assert.ok(!sysOf(ai({ wantExample: false })).includes('"example"'));
  const r = T.parseAiResponse(wrap('{"translation":"дом","example":"Das Haus ist alt."}'));
  assert.equal(r.example, "Das Haus ist alt.");
});

test("wider context reaches the user message only when it adds information", () => {
  const r = ai({ word: "Bank", context: "Er saß auf der Bank.", wide: "Der Park war leer. Er saß auf der Bank. Die Enten schwammen vorbei." });
  assert.ok(userOf(r).includes("Wider context: Der Park war leer."));
  const same = ai({ word: "Bank", context: "Satz.", wide: "Satz." });
  assert.ok(!userOf(same).includes("Wider context"));
});

test("learner level and reroll (avoid) shape the request", () => {
  const lvl = ai({ level: "C1" });
  assert.ok(userOf(lvl).includes("Learner level: C1"));
  assert.equal(JSON.parse(lvl.options.body).temperature, 0);

  const rr = ai({ avoid: "может" });
  assert.ok(userOf(rr).includes("not: может"));
  assert.equal(JSON.parse(rr.options.body).temperature, 0.7);

  assert.ok(!userOf(ai()).includes("Learner level"));
});

test("batch request carries text, level and target language", () => {
  const r = T.buildBatchRequest({ baseUrl: "https://x/v1", model: "m", apiKey: "k", text: "Ein langer Absatz.", targetLang: "ru", level: "B2", extra: "" });
  assert.equal(r.url, "https://x/v1/chat/completions");
  const user = userOf(r);
  assert.ok(user.includes("Ein langer Absatz."));
  assert.ok(user.includes("Learner level: B2"));
  assert.ok(sysOf(r).includes('"items"'));
});

test("parseBatchResponse validates, filters and caps items", () => {
  const good = T.parseBatchResponse(wrap(JSON.stringify({ items: [
    { word: "ertüchtigen", headword: "ertüchtigen", forms: "ertüchtigen (ertüchtigt), ertüchtigte, hat ertüchtigt", translation: "укреплять", note: "" },
    { word: "", headword: "x", forms: "", translation: "пусто", note: "" },
    { word: "ohne", headword: "", forms: "", translation: "", note: "" },
  ] })));
  assert.equal(good.length, 1);
  assert.equal(good[0].word, "ertüchtigen");
  assert.equal(T.parseBatchResponse(wrap('{"items":[]}')), null);
  assert.equal(T.parseBatchResponse(wrap("мусор")), null);
  assert.equal(T.parseBatchResponse(null), null);
});
