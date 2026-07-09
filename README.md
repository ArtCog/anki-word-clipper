# Anki Word Clipper

**English** · [Русский](README.ru.md)

Browser extension (Chrome + Firefox): select a word or phrase on any page — and in one or two clicks it lands in Anki **together with the sentence context and the source link**. Everything runs locally through [AnkiConnect](https://ankiweb.net/shared/info/2055492159); no data leaves your machine unless you enable translation.

## Installation

### 1. Anki

1. Install and run Anki Desktop.
2. Install the **AnkiConnect** add-on: `Tools → Add-ons → Get Add-ons…` → code `2055492159` → restart Anki.
3. Keep Anki running while you use the extension.

### 2. Extension — Chrome / Edge / Brave

1. Open `chrome://extensions` and enable **Developer mode**.
2. Download the ZIP from [Releases](https://github.com/ArtCog/anki-word-clipper/releases) and unpack it into a permanent folder (or clone this repository).
3. **Load unpacked** → pick that folder.
4. Warnings about `background.scripts` and `browser_specific_settings` are expected — those keys are for Firefox; Chrome ignores them.

### 3. Extension — Firefox

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
2. In `about:addons` → Anki Word Clipper → **Permissions** → enable “Access your data for all websites” (Firefox MV3 grants host access manually).

### 4. First connection

On first use Anki shows the dialog “An application is attempting to access Anki” — click **Yes**. The extension automatically creates the note types **Word Clipper** (fields: Word, Translation, Context, Source, AddReverse) and **Word Clipper Cloze**.

## Usage

- **Select text** → the **“+ Anki”** button appears next to the selection → click → mini-form: the word and its sentence are pre-filled, the cursor is in the translation field → `Enter`.
- **Auto-translation:** the translation field fills itself. Pick the engine in the popup (“Перевод” section): **Google** (works out of the box), **DeepL** (better quality, free key at [deepl.com/pro-api](https://www.deepl.com/pro-api)) or **AI**. If the chosen engine fails, Google silently covers for it. Editing the word re-translates it; anything you typed yourself is never overwritten.
- **AI engine:** translates the word *in its sentence context* and normalizes it to the dictionary form (`Häusern` → `das Haus, die Häuser`) with a short grammar note. Any OpenAI-compatible provider works: Google Gemini (free key at [aistudio.google.com](https://aistudio.google.com/apikey)), OpenRouter, OpenAI, or a local Ollama (no key). The “Проверить ИИ” button in the popup shows a sample response.
- **Card types:** basic, two-way (adds a reverse “translation → word” card), and cloze (the word is blanked out inside your sentence). Choose per-card in the form; set the default in the popup.
- **Text-to-speech (Anki TTS):** pick a language in the popup — cards will pronounce the word using the system voice, no external services.
- **Empty translation is fine** — the “capture now, translate later in Anki” workflow is supported on purpose.
- **The form is draggable** by its “+ Anki” header; a click outside closes it.
- **Instant mode** (popup): a click on the button adds the card immediately, no form. `Shift+click` always does the opposite (form ↔ instant).
- **Right-click a selection** → “Добавить в Anki…” (form) or “Добавить в Anki мгновенно”.
- **Hotkey** `Alt+A` — open the form for the current selection.
- **Duplicates:** if the word already exists, the extension says so and offers “add anyway”.

## Known limitations

- Does not work on browser-internal pages (`chrome://`, Chrome Web Store, addons.mozilla.org).
- **Google Docs** is not supported (text is drawn on canvas — the selection is invisible to extensions).
- **Chrome PDF viewer:** no floating button; only right-click → “instant add” works (without sentence context). Result is shown as a badge on the extension icon.
- Cards reach your phone only after Anki ↔ AnkiWeb sync.

## Privacy

Cards live only in your Anki (`http://127.0.0.1:8765`, local AnkiConnect). No analytics, no cloud. The only exception is **auto-translation**: when enabled (default), the selected word is sent to the chosen engine (Google Translate, DeepL, or your AI provider). Turn off auto-translation in the popup — and the extension is 100% local again.

## Development

Zero build: the repository *is* the extension. Pure logic lives in `context-extract.js`, `anki-client.js` and `translator.js`, covered by tests:

```bash
node --test tests/context-extract.test.js tests/anki-client.test.js tests/translator.test.js
```

Icons: `bash scripts/make-icons.sh` (requires ffmpeg; font path via the `FONT` env var).

## License

[MIT](LICENSE)
