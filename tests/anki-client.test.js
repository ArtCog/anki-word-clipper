const { test } = require("node:test");
const assert = require("node:assert/strict");
const A = require("../anki-client.js");

test("escapeHtml escapes &<>\"", () => {
  assert.equal(A.escapeHtml(`a & <b> "c"`), "a &amp; &lt;b&gt; &quot;c&quot;");
});

test("buildNoteFields maps reverse flag to AddReverse y/empty", () => {
  const base = { word: "Haus", translation: "дом", context: "Das Haus ist alt.", source: "s" };
  assert.equal(A.buildNoteFields({ ...base, reverse: true }).AddReverse, "y");
  assert.equal(A.buildNoteFields({ ...base, reverse: false }).AddReverse, "");
});

test("buildNoteFields bolds first case-insensitive occurrence of word in context", () => {
  const f = A.buildNoteFields({
    word: "haus", translation: "", source: "",
    context: "Das Haus ist alt.", reverse: false,
  });
  assert.equal(f.Context, "Das <b>Haus</b> ist alt.");
});

test("buildNoteFields escapes HTML before bolding", () => {
  const f = A.buildNoteFields({
    word: "x<y", translation: "", source: "",
    context: "wert x<y hier", reverse: false,
  });
  assert.equal(f.Context, "wert <b>x&lt;y</b> hier");
});

test("buildNoteFields leaves context unchanged when word absent", () => {
  const f = A.buildNoteFields({
    word: "Hund", translation: "", source: "", context: "Ohne Treffer.", reverse: false,
  });
  assert.equal(f.Context, "Ohne Treffer.");
});

test("buildAddNoteRequest shape", () => {
  const r = A.buildAddNoteRequest({
    word: "Haus", translation: "дом", context: "", source: "", reverse: true,
    deck: "Deutsch", allowDuplicate: true,
  });
  assert.equal(r.action, "addNote");
  assert.equal(r.version, 6);
  assert.equal(r.params.note.deckName, "Deutsch");
  assert.equal(r.params.note.modelName, "Word Clipper");
  assert.deepEqual(r.params.note.tags, ["word-clipper"]);
  assert.equal(r.params.note.options.allowDuplicate, true);
  assert.equal(r.params.note.fields.Word, "Haus");
});

test("classifyAnkiError", () => {
  assert.equal(A.classifyAnkiError("cannot create note because it is a duplicate"), "DUPLICATE");
  assert.equal(A.classifyAnkiError("deck was not found: Foo"), "DECK_MISSING");
  assert.equal(A.classifyAnkiError("model was not found: Word Clipper"), "MODEL_MISSING");
  assert.equal(A.classifyAnkiError("valid api key must be provided"), "PERMISSION_DENIED");
  assert.equal(A.classifyAnkiError("something odd"), "UNKNOWN");
});

test("interpretResponse", () => {
  assert.deepEqual(A.interpretResponse({ result: ["a"], error: null }), { ok: true, result: ["a"] });
  const err = A.interpretResponse({ result: null, error: "cannot create note because it is a duplicate" });
  assert.equal(err.ok, false);
  assert.equal(err.code, "DUPLICATE");
  assert.equal(A.interpretResponse({}).ok, false);
  assert.equal(A.interpretResponse(null).ok, false);
});

test("MODEL_DEF has conditional reverse template and exact fields", () => {
  assert.deepEqual(A.MODEL_DEF.inOrderFields, ["Word", "Translation", "Context", "Source", "AddReverse"]);
  assert.equal(A.MODEL_DEF.modelName, "Word Clipper");
  assert.equal(A.MODEL_DEF.cardTemplates.length, 2);
  const rev = A.MODEL_DEF.cardTemplates[1];
  assert.ok(rev.Front.startsWith("{{#AddReverse}}"));
  assert.ok(rev.Front.endsWith("{{/AddReverse}}"));
});
