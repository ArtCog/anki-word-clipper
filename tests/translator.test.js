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
