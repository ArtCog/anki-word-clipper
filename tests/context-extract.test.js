const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractContext } = require("../context-extract.js");

function sel(text, word) {
  const start = text.indexOf(word);
  assert.notEqual(start, -1, `word "${word}" not in text`);
  return [text, start, start + word.length];
}

test("extracts the middle sentence", () => {
  const c = extractContext(...sel("First one. Second target here. Third one.", "target"));
  assert.equal(c.before, "Second ");
  assert.equal(c.word, "target");
  assert.equal(c.after, " here.");
});

test("German abbreviation z. B. is not a sentence boundary", () => {
  const c = extractContext(...sel("Vorher ein Satz. Das ist z. B. ein guter Test. Danach mehr.", "guter"));
  assert.equal(c.before, "Das ist z. B. ein ");
  assert.equal(c.after, " Test.");
});

test("lowercase after dot is not a boundary (Dr. etc.)", () => {
  const c = extractContext(...sel("Anfang war da. Dr. Müller sagte etwas Kluges. Ende.", "Kluges"));
  assert.equal(c.before, "Dr. Müller sagte etwas ");
  assert.equal(c.after, ".");
});

test("selection at the very start and end of text", () => {
  const a = extractContext(...sel("Wort am Anfang steht hier.", "Wort"));
  assert.equal(a.before, "");
  assert.equal(a.after, " am Anfang steht hier.");
  const b = extractContext(...sel("Hier steht es am Ende", "Ende"));
  assert.equal(b.before, "Hier steht es am ");
  assert.equal(b.after, "");
});

test("newline is a boundary", () => {
  const c = extractContext(...sel("Erste Zeile ohne Punkt\nZweite Zeile mit Wort darin\nDritte Zeile", "Wort"));
  assert.equal(c.before, "Zweite Zeile mit ");
  assert.equal(c.after, " darin");
});

test("multi-word phrase selection", () => {
  const c = extractContext(...sel("Ich habe die große Herausforderung angenommen. Weiter.", "große Herausforderung"));
  assert.equal(c.before, "Ich habe die ");
  assert.equal(c.after, " angenommen.");
});

test("long context is capped near maxLen with ellipses", () => {
  const long = "x".repeat(400) + " mitte " + "y".repeat(400);
  const start = long.indexOf("mitte");
  const c = extractContext(long, start, start + 5, 300);
  const total = c.before.length + c.word.length + c.after.length;
  assert.ok(total <= 302, `total ${total} should be ~<=300 (+ellipses)`);
  assert.ok(c.before.startsWith("…"));
  assert.ok(c.after.endsWith("…"));
  assert.equal(c.word, "mitte");
});

test("sentences=2 captures one neighbouring sentence on each side", () => {
  const text = "Der Park war leer. Er saß auf der Bank. Die Enten schwammen vorbei. Es wurde dunkel.";
  const start = text.indexOf("Bank");
  const c = extractContext(text, start, start + 4, 700, 2);
  const full = c.before + c.word + c.after;
  assert.ok(full.includes("Der Park war leer."));
  assert.ok(full.includes("Die Enten schwammen vorbei."));
  assert.ok(!full.includes("Es wurde dunkel."));
});
