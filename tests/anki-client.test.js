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
  assert.deepEqual(A.MODEL_DEF.inOrderFields, ["Word", "Translation", "Context", "Source", "AddReverse", "Forms", "Example", "OnlyReverse"]);
  assert.equal(A.MODEL_DEF.modelName, "Word Clipper");
  assert.equal(A.MODEL_DEF.cardTemplates.length, 2);
  const rev = A.MODEL_DEF.cardTemplates[1];
  assert.ok(rev.Front.startsWith("{{#AddReverse}}"));
  assert.ok(rev.Front.endsWith("{{/AddReverse}}"));
});

test("buildModelDef embeds tts tag for the chosen language, none when off", () => {
  const de = A.buildModelDef("de_DE");
  assert.ok(de.cardTemplates[0].Front.includes("{{tts de_DE:Word}}"));
  assert.ok(de.cardTemplates[1].Back.includes("{{tts de_DE:Word}}"));
  const off = A.buildModelDef("off");
  assert.ok(!JSON.stringify(off.cardTemplates).includes("{{tts"));
});

test("buildNoteFields bolds by matchWord when word was normalized to headword", () => {
  const f = A.buildNoteFields({
    word: "das Haus, die Häuser", translation: "дом", source: "",
    context: "In den Häusern ist es warm.", reverse: false, matchWord: "Häusern",
  });
  assert.equal(f.Word, "das Haus, die Häuser");
  assert.equal(f.Context, "In den <b>Häusern</b> ist es warm.");
});

test("buildClozeText wraps the word occurrence, appends when absent", () => {
  assert.equal(
    A.buildClozeText("In den Häusern ist es warm.", "Häusern"),
    "In den {{c1::Häusern}} ist es warm."
  );
  assert.equal(A.buildClozeText("", "Haus"), "{{c1::Haus}}");
  assert.equal(A.buildClozeText("Ohne Treffer.", "Haus"), "Ohne Treffer.<br>{{c1::Haus}}");
});

test("buildClozeNoteRequest uses cloze model and original word for the gap", () => {
  const r = A.buildClozeNoteRequest({
    word: "das Haus, die Häuser", matchWord: "Häusern", translation: "дом",
    context: "In den Häusern ist es warm.", source: "s", deck: "Deutsch", allowDuplicate: false,
  });
  assert.equal(r.params.note.modelName, "Word Clipper Cloze");
  assert.equal(r.params.note.fields.Text, "In den {{c1::Häusern}} ist es warm.");
  assert.equal(r.params.note.fields.Translation, "дом");
  assert.deepEqual(r.params.note.tags, ["word-clipper"]);
});

test("cloze model def is isCloze with Text field first", () => {
  const d = A.buildClozeModelDef();
  assert.equal(d.modelName, "Word Clipper Cloze");
  assert.equal(d.isCloze, true);
  assert.equal(d.inOrderFields[0], "Text");
  assert.ok(d.cardTemplates[0].Front.includes("{{cloze:Text}}"));
});

test("buildNoteFields stores verb forms in the Forms field", () => {
  const f = A.buildNoteFields({
    word: "verzögert", translation: "задерживает", context: "", source: "",
    reverse: false, forms: "verzögern, verzögerte, hat verzögert",
  });
  assert.equal(f.Forms, "verzögern, verzögerte, hat verzögert");
  assert.equal(f.Word, "verzögert");
  assert.equal(A.buildNoteFields({ word: "Haus", translation: "", context: "", source: "", reverse: false }).Forms, "");
});

test("buildNoteFields stores example in the Example field", () => {
  const f = A.buildNoteFields({
    word: "Haus", translation: "", context: "", source: "", reverse: false,
    example: "Das Haus ist alt.",
  });
  assert.equal(f.Example, "Das Haus ist alt.");
});

test("reverse-only: forward template is suppressed via OnlyReverse", () => {
  const fwd = A.MODEL_DEF.cardTemplates[0].Front;
  assert.ok(fwd.startsWith("{{^OnlyReverse}}"));
  assert.ok(fwd.endsWith("{{/OnlyReverse}}"));
  const f = A.buildNoteFields({
    word: "Haus", translation: "дом", context: "", source: "",
    reverse: true, onlyReverse: true,
  });
  assert.equal(f.AddReverse, "y");
  assert.equal(f.OnlyReverse, "y");
  assert.equal(A.buildNoteFields({ word: "x", translation: "", context: "", source: "", reverse: true }).OnlyReverse, "");
});
