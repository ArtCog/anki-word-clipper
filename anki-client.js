// Pure AnkiConnect helpers: request building, response interpretation,
// note-model definition. No fetch here — background.js owns HTTP.
const MODEL_NAME = "Word Clipper";

const CARD_CSS = `
.card { font-family: "Segoe UI", -apple-system, sans-serif; font-size: 24px; text-align: center; }
.translation { margin-top: .2em; }
.context { margin-top: .9em; font-size: .75em; opacity: .75; }
.context b { color: #2fb890; }
.source { margin-top: 1.4em; font-size: .5em; opacity: .4; word-break: break-all; }
`.trim();

const MODEL_DEF = {
  modelName: MODEL_NAME,
  inOrderFields: ["Word", "Translation", "Context", "Source", "AddReverse"],
  css: CARD_CSS,
  isCloze: false,
  cardTemplates: [
    {
      Name: "Word → Translation",
      Front: `<div class="word">{{Word}}</div>`,
      Back: `{{FrontSide}}<hr id="answer"><div class="translation">{{Translation}}</div><div class="context">{{Context}}</div><div class="source">{{Source}}</div>`,
    },
    {
      Name: "Translation → Word",
      Front: `{{#AddReverse}}<div class="word">{{Translation}}</div>{{/AddReverse}}`,
      Back: `{{FrontSide}}<hr id="answer"><div class="translation">{{Word}}</div><div class="context">{{Context}}</div>`,
    },
  ],
};

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function boldWord(contextEscaped, wordEscaped) {
  if (!wordEscaped) return contextEscaped;
  const idx = contextEscaped.toLowerCase().indexOf(wordEscaped.toLowerCase());
  if (idx === -1) return contextEscaped;
  return (
    contextEscaped.slice(0, idx) +
    "<b>" + contextEscaped.slice(idx, idx + wordEscaped.length) + "</b>" +
    contextEscaped.slice(idx + wordEscaped.length)
  );
}

function buildNoteFields({ word, translation, context, source, reverse }) {
  const w = escapeHtml(String(word).trim());
  return {
    Word: w,
    Translation: escapeHtml(String(translation ?? "").trim()),
    Context: boldWord(escapeHtml(String(context ?? "").trim()), w),
    Source: escapeHtml(String(source ?? "")),
    AddReverse: reverse ? "y" : "",
  };
}

function buildAddNoteRequest(note) {
  return {
    action: "addNote",
    version: 6,
    params: {
      note: {
        deckName: note.deck,
        modelName: MODEL_NAME,
        fields: buildNoteFields(note),
        options: { allowDuplicate: !!note.allowDuplicate },
        tags: ["word-clipper"],
      },
    },
  };
}

function classifyAnkiError(message) {
  const m = String(message).toLowerCase();
  if (m.includes("duplicate")) return "DUPLICATE";
  if (m.includes("deck") && m.includes("not found")) return "DECK_MISSING";
  if (m.includes("model") && m.includes("not found")) return "MODEL_MISSING";
  if (m.includes("permission") || m.includes("api key")) return "PERMISSION_DENIED";
  return "UNKNOWN";
}

function interpretResponse(json) {
  if (!json || typeof json !== "object" || !("result" in json || "error" in json)) {
    return { ok: false, code: "UNKNOWN", message: "Некорректный ответ AnkiConnect" };
  }
  if (json.error != null) {
    return { ok: false, code: classifyAnkiError(json.error), message: String(json.error) };
  }
  return { ok: true, result: json.result };
}

const AnkiClient = {
  MODEL_NAME, MODEL_DEF, escapeHtml, boldWord,
  buildNoteFields, buildAddNoteRequest, classifyAnkiError, interpretResponse,
};
if (typeof module !== "undefined" && module.exports) module.exports = AnkiClient;
