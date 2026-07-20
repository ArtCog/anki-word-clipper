// Pure sentence-context extraction. Loaded as a classic script by the
// content script (global `ContextExtract`) and via require() in Node tests.
const ABBREVIATIONS = [
  "z. B.", "z.B.", "d. h.", "d.h.", "u. a.", "u.a.", "usw.", "bzw.", "ggf.",
  "ca.", "Dr.", "Prof.", "Nr.", "St.", "Abs.", "etc.", "e.g.", "i.e.",
  "Mr.", "Mrs.", "Ms.", "т. д.", "т. п.", "др.",
];

const ENDERS = new Set([".", "!", "?", "…"]);

// True when the dot at dotIndex sits anywhere inside a known abbreviation
// (not only at its end — "z. B." must shield its first dot too), and the
// abbreviation starts at a word boundary.
function isAbbreviation(text, dotIndex) {
  return ABBREVIATIONS.some((a) => {
    for (let p = a.indexOf("."); p !== -1; p = a.indexOf(".", p + 1)) {
      const s = dotIndex - p;
      if (s < 0 || !text.startsWith(a, s)) continue;
      if (s > 0 && /[\p{L}\p{N}]/u.test(text[s - 1])) continue; // inside a word
      return true;
    }
    return false;
  });
}

// A char at index i ends a sentence if it is .!?… followed by whitespace and
// then an uppercase letter / digit / opening quote — and is not a known
// abbreviation. Newline always ends a "sentence" (headings, list items).
function isBoundary(text, i) {
  const ch = text[i];
  if (ch === "\n") return true;
  if (!ENDERS.has(ch)) return false;
  if (ch === "." && isAbbreviation(text, i)) return false;
  let j = i + 1;
  while (j < text.length && "\"'»«)]".includes(text[j])) j++;
  if (j >= text.length) return true;
  if (!/\s/.test(text[j])) return false;
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) return true;
  return /[\p{Lu}\p{N}"'«„¿¡([-]/u.test(text[j]);
}

// sentences: how many sentence boundaries to cross on each side (1 = the
// sentence itself, 2 = plus one neighbouring sentence each side, …)
function extractContext(text, selStart, selEnd, maxLen = 300, sentences = 1) {
  let start = 0, foundL = 0;
  for (let i = selStart - 1; i >= 0; i--) {
    if (isBoundary(text, i) && ++foundL >= sentences) { start = i + 1; break; }
  }
  let end = text.length, foundR = 0;
  for (let i = selEnd; i < text.length; i++) {
    if (isBoundary(text, i) && ++foundR >= sentences) { end = text[i] === "\n" ? i : i + 1; break; }
  }
  let before = text.slice(start, selStart).replace(/^\s+/, "");
  const word = text.slice(selStart, selEnd);
  let after = text.slice(selEnd, end).replace(/\s+$/, "");

  const budget = Math.max(0, maxLen - word.length);
  if (before.length + after.length > budget) {
    const half = Math.floor(budget / 2);
    const bWant = Math.min(before.length, Math.max(half, budget - after.length));
    const aWant = Math.min(after.length, budget - bWant);
    if (before.length > bWant) before = "…" + before.slice(before.length - bWant);
    if (after.length > aWant) after = after.slice(0, aWant) + "…";
  }
  return { before, word, after };
}

const ContextExtract = { extractContext, ABBREVIATIONS };
if (typeof module !== "undefined" && module.exports) module.exports = ContextExtract;
