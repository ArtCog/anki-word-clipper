(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const MAX_SEL_LEN = 500;

  const ERROR_TEXT = {
    ANKI_UNREACHABLE: "Anki недоступен — запусти Anki с AnkiConnect",
    PERMISSION_DENIED: "Anki не разрешил доступ — нажми «Yes» в окне Anki",
    DUPLICATE: "Уже есть в колоде",
    DECK_MISSING: "Колода не найдена — обнови список",
    MODEL_MISSING: "Тип карточки не найден — открой попап расширения",
    UNKNOWN: "Ошибка Anki",
  };
  const errText = (res) => {
    if (String(res?.message ?? "").toLowerCase().includes("context invalidated")) {
      return "Расширение обновилось — обнови страницу (F5)";
    }
    return ERROR_TEXT[res?.code] ?? res?.message ?? ERROR_TEXT.UNKNOWN;
  };

  // async wrapper also catches the synchronous throw that happens when the
  // extension was reloaded and this page still runs the old content script
  const send = async (msg) => {
    try {
      return await api.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, code: "UNKNOWN", message: String(e?.message ?? e) };
    }
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
    .wc-btn {
      position: fixed; display: none; z-index: 2147483647;
      background: #0B0F0E; color: #E8EDEB; border: 1px solid #3CE5B0; border-radius: 8px;
      padding: 4px 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,.35);
    }
    .wc-btn.show { display: block; }
    .wc-btn:hover { background: #16211d; }
    .wc-form {
      position: fixed; display: none; z-index: 2147483647; width: 324px;
      background: #0d1211; color: #E8EDEB; border: 1px solid #24312c; border-top: 2px solid #3CE5B0;
      border-radius: 14px; padding: 14px; font-size: 13px;
      box-shadow: 0 10px 40px rgba(0,0,0,.55);
    }
    .wc-form.show { display: block; }
    .wc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #3CE5B0; font-weight: 700; cursor: move; user-select: none; touch-action: none; }
    .wc-x { background: none; border: 0; color: #E8EDEB; font-size: 16px; cursor: pointer; opacity: .6; }
    .wc-x:hover { opacity: 1; }
    label { display: block; margin: 6px 0 2px; font-size: 11px; opacity: .65; }
    input[type=text], textarea, select {
      width: 100%; background: #16211d; color: #E8EDEB; border: 1px solid #26332e;
      border-radius: 8px; padding: 7px 9px; font-size: 13px; transition: border-color .12s;
    }
    textarea { resize: vertical; min-height: 44px; transition: height .12s; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #3CE5B0; }
    .wc-note { font-size: 11px; color: #7bdcc0; opacity: .95; margin: 5px 0 0; }
    .wc-note:empty { display: none; }
    .wc-row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
    .wc-add {
      background: #3CE5B0; color: #0B0F0E; border: 0; border-radius: 8px;
      padding: 7px 16px; font-weight: 700; cursor: pointer;
    }
    .wc-add:hover { filter: brightness(1.08); }
    .wc-add:disabled { opacity: .5; cursor: default; }
    .wc-status { font-size: 12px; opacity: .85; }
    .wc-status.err { color: #ff8a8a; }
    .wc-status button { background: none; border: 0; color: #3CE5B0; cursor: pointer; padding: 0; font-size: 12px; text-decoration: underline; }
    .wc-toast {
      position: fixed; right: 18px; bottom: 18px; display: none; z-index: 2147483647;
      background: #0B0F0E; color: #E8EDEB; border: 1px solid #3CE5B0; border-radius: 10px;
      padding: 9px 14px; font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,.45);
    }
    .wc-toast.show { display: flex; gap: 10px; align-items: center; }
    .wc-toast button { background: none; border: 0; color: #3CE5B0; cursor: pointer; font-size: 13px; text-decoration: underline; padding: 0; }
  `;

  let host, shadow, btn, form, toast, toastTimer;
  let lastCapture = null;
  let currentCapture = null;

  const q = (sel) => form.querySelector(sel);

  // ---------- capture ----------

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_SEL_LEN) return null;
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el || el.closest("input, textarea, [contenteditable=''], [contenteditable=true]")) return null;
    return { text, range: sel.getRangeAt(0) };
  }

  const BLOCK = "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, article, section, div, body";

  function blockTextAround(range) {
    const c = range.startContainer;
    const el = (c instanceof Element ? c : c.parentElement)?.closest(BLOCK);
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = "", selStart = -1, selEnd = -1, n;
    while ((n = walker.nextNode())) {
      if (n === range.startContainer) selStart = text.length + range.startOffset;
      if (n === range.endContainer) selEnd = text.length + range.endOffset;
      text += n.nodeValue;
    }
    return selStart >= 0 && selEnd >= selStart ? { text, selStart, selEnd } : null;
  }

  function capture() {
    const info = selectionInfo();
    if (!info) return null;
    let context = "";
    const block = blockTextAround(info.range);
    if (block) {
      const c = ContextExtract.extractContext(block.text, block.selStart, block.selEnd);
      context = (c.before + c.word + c.after).replace(/\s+/g, " ").trim();
    }
    return {
      word: info.text,
      context,
      source: `${document.title} — ${location.href}`,
      rect: info.range.getBoundingClientRect(),
    };
  }

  // ---------- UI scaffolding ----------

  function ensureUi() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;

    btn = document.createElement("button");
    btn.className = "wc-btn";
    btn.textContent = "+ Anki";
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onButton(e);
    });

    form = document.createElement("div");
    form.className = "wc-form";
    form.innerHTML = `
      <div class="wc-head"><span>+ Anki</span><button class="wc-x" title="Закрыть">×</button></div>
      <label>Слово / фраза</label><input type="text" class="wc-word">
      <label>Перевод / пояснение</label><input type="text" class="wc-tr" placeholder="можно оставить пустым">
      <div class="wc-note"></div>
      <label>Контекст</label><textarea class="wc-ctx" rows="2"></textarea>
      <label>Тип карточки</label><select class="wc-type">
        <option value="basic">Обычная (слово → перевод)</option>
        <option value="reverse">Двусторонняя (+ перевод → слово)</option>
        <option value="cloze">Пропуск в предложении (cloze)</option>
      </select>
      <label>Колода</label><select class="wc-deck"></select>
      <div class="wc-row"><button class="wc-add">Добавить</button><span class="wc-status"></span></div>
    `;
    form.querySelector(".wc-x").addEventListener("click", closeForm);
    form.querySelector(".wc-add").addEventListener("click", () => submit(false));

    // re-translate when the word is edited by hand; stop auto-filling once
    // the user typed their own translation
    const wordInput = form.querySelector(".wc-word");
    const trInput = form.querySelector(".wc-tr");
    let wordTimer;
    trInput.addEventListener("input", () => { trEdited = true; });
    wordInput.addEventListener("input", () => {
      clearTimeout(wordTimer);
      wordTimer = setTimeout(() => { if (!trEdited) requestTranslation(wordInput.value); }, 600);
    });

    // context textarea grows to its content while focused
    const ctxInput = form.querySelector(".wc-ctx");
    ctxInput.addEventListener("focus", () => {
      ctxInput.style.height = "auto";
      ctxInput.style.height = `${Math.min(ctxInput.scrollHeight + 2, 180)}px`;
    });
    ctxInput.addEventListener("blur", () => { ctxInput.style.height = ""; });

    // drag the form by its header
    const head = form.querySelector(".wc-head");
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".wc-x")) return;
      const r = form.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev) => {
        form.style.left = `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - 60))}px`;
        form.style.top = `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40))}px`;
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
      };
      head.setPointerCapture(e.pointerId);
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
      e.preventDefault();
    });
    form.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep page hotkeys away from our form
      if (e.key === "Escape") closeForm();
      if (e.key === "Enter" && (e.target.tagName !== "TEXTAREA" || e.ctrlKey)) {
        e.preventDefault();
        submit(false);
      }
    });

    toast = document.createElement("div");
    toast.className = "wc-toast";

    shadow.append(style, btn, form, toast);
    document.documentElement.append(host);
  }

  // ---------- button ----------

  function hideButton() { if (btn) btn.classList.remove("show"); }
  const formOpen = () => form?.classList.contains("show");

  function maybeShowButton() {
    ensureUi();
    if (formOpen()) return;
    setTimeout(() => {
      const cap = capture();
      if (!cap) { hideButton(); return; }
      lastCapture = cap;
      btn.style.left = `${Math.min(cap.rect.right + 6, innerWidth - 80)}px`;
      btn.style.top = `${Math.max(cap.rect.top - 34, 4)}px`;
      btn.classList.add("show");
    }, 10);
  }

  document.addEventListener("mouseup", (e) => {
    if (!host || e.composedPath()[0] !== host) maybeShowButton();
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift" || e.shiftKey) maybeShowButton();
  });
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if ((!sel || sel.isCollapsed) && !formOpen()) hideButton();
  });
  // click anywhere outside the form closes it
  document.addEventListener("mousedown", (e) => {
    if (formOpen() && !e.composedPath().includes(host)) closeForm();
  }, true);
  window.addEventListener("scroll", hideButton, { passive: true, capture: true });

  async function onButton(e) {
    hideButton();
    const res = await send({ type: "GET_SETTINGS" });
    const instant = !!res?.settings?.instantMode !== e.shiftKey; // shift inverts the mode
    if (instant) instantAdd(lastCapture);
    else openForm(lastCapture);
  }

  // ---------- form ----------

  async function openForm(cap) {
    if (!cap) return;
    ensureUi();
    currentCapture = cap;
    trEdited = false;
    q(".wc-word").value = cap.word;
    q(".wc-tr").value = "";
    q(".wc-ctx").value = cap.context;
    q(".wc-note").textContent = "";
    setStatus("");
    const left = Math.max(8, Math.min(cap.rect.left, innerWidth - 336));
    const top = cap.rect.bottom + 8 + 340 < innerHeight ? cap.rect.bottom + 8 : Math.max(8, cap.rect.top - 348);
    form.style.left = `${left}px`;
    form.style.top = `${top}px`;
    form.classList.add("show");

    const st = await send({ type: "GET_SETTINGS" });
    q(".wc-type").value = st?.settings?.defaultCardType ?? "basic";
    q(".wc-tr").focus();
    requestTranslation(cap.word);

    const deckSel = q(".wc-deck");
    deckSel.innerHTML = "<option>Загружаю колоды…</option>";
    const res = await send({ type: "GET_DECKS" });
    if (!res.ok) {
      deckSel.innerHTML = "<option value=''>—</option>";
      setStatus(errText(res), true, { label: "Повторить", fn: () => openForm(currentCapture) });
      return;
    }
    deckSel.innerHTML = "";
    for (const d of res.decks) {
      const o = document.createElement("option");
      o.value = o.textContent = d;
      deckSel.append(o);
    }
    if (res.lastDeck && res.decks.includes(res.lastDeck)) deckSel.value = res.lastDeck;
    q(".wc-tr").focus();
  }

  function closeForm() {
    form?.classList.remove("show");
    currentCapture = null;
  }

  // Fill the translation field asynchronously; never overwrite what the
  // user already typed, and ignore stale responses after a reopen. With an AI
  // provider we also get a dictionary headword (put into Word) and a short
  // grammar note (shown as a hint).
  let translateSeq = 0;
  let trEdited = false; // user typed their own translation — never overwrite it
  async function requestTranslation(word) {
    if (!word?.trim()) return;
    const seq = ++translateSeq;
    const tr = q(".wc-tr");
    tr.placeholder = "перевожу…";
    const res = await send({ type: "TRANSLATE", text: word, context: q(".wc-ctx").value });
    if (seq !== translateSeq || !formOpen()) return;
    tr.placeholder = "можно оставить пустым";
    if (!res.ok) return;
    if (!trEdited) tr.value = res.translation;
    if (res.provider === "ai") {
      if (res.headword && !trEdited) q(".wc-word").value = res.headword;
      q(".wc-note").textContent = res.note ?? "";
    }
  }

  function setStatus(text, isErr = false, action = null) {
    const box = q(".wc-status");
    box.className = `wc-status${isErr ? " err" : ""}`;
    box.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", action.fn);
      box.append(" ", b);
    }
  }

  async function submit(allowDuplicate) {
    const cardType = q(".wc-type").value;
    const note = {
      word: q(".wc-word").value,
      matchWord: currentCapture?.word ?? q(".wc-word").value, // the form in the sentence
      translation: q(".wc-tr").value,
      context: q(".wc-ctx").value,
      source: currentCapture?.source ?? `${document.title} — ${location.href}`,
      cardType,
      deck: q(".wc-deck").value,
      allowDuplicate,
    };
    if (!note.word.trim()) return setStatus("Слово пустое", true);
    if (!note.deck) return setStatus("Выбери колоду", true);
    if (cardType === "cloze" && !note.context.trim()) {
      return setStatus("Для cloze нужен контекст", true);
    }
    q(".wc-add").disabled = true;
    setStatus("Добавляю…");
    const res = await send({ type: "ADD_NOTE", note });
    q(".wc-add").disabled = false;
    if (res.ok) {
      send({ type: "SET_SETTINGS", patch: { defaultCardType: cardType } });
      closeForm();
      showToast("Добавлено в Anki ✓");
    } else if (res.code === "DUPLICATE") {
      setStatus("Уже есть в колоде", true, { label: "Добавить всё равно", fn: () => submit(true) });
    } else {
      setStatus(errText(res), true); // form stays open, input preserved
    }
  }

  // ---------- instant mode ----------

  async function instantAdd(cap, allowDuplicate = false) {
    if (!cap) return;
    ensureUi();
    const st = await send({ type: "GET_SETTINGS" });
    const deck = st?.settings?.lastDeck;
    if (!deck) { openForm(cap); return; } // first ever use: no deck yet — fall back to form
    let cardType = st.settings.defaultCardType ?? "basic";
    if (cardType === "cloze" && !cap.context) cardType = "basic"; // no sentence → no gap
    let word = cap.word, translation = "";
    const tr = await send({ type: "TRANSLATE", text: cap.word, context: cap.context });
    if (tr.ok) {
      translation = tr.translation;
      if (tr.provider === "ai" && tr.headword) word = tr.headword;
    }
    const note = {
      word, matchWord: cap.word, translation, context: cap.context, source: cap.source,
      cardType, deck, allowDuplicate,
    };
    const res = await send({ type: "ADD_NOTE", note });
    if (res.ok) showToast(`Добавлено в «${deck}» ✓`);
    else if (res.code === "DUPLICATE" && !allowDuplicate) {
      showToast("Уже есть в колоде", { label: "Добавить всё равно", fn: () => instantAdd(cap, true) });
    } else showToast(errText(res));
  }

  // ---------- toast ----------

  function showToast(text, action = null) {
    ensureUi();
    clearTimeout(toastTimer);
    toast.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", () => { hideToast(); action.fn(); });
      toast.append(b);
    }
    toast.classList.add("show");
    toastTimer = setTimeout(hideToast, action ? 7000 : 2500);
  }

  function hideToast() { toast?.classList.remove("show"); }

  // ---------- external triggers (context menu / hotkey) ----------

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "OPEN_FORM") { const c = capture() ?? lastCapture; if (c) openForm(c); }
    if (msg?.type === "INSTANT_ADD") { const c = capture() ?? lastCapture; if (c) instantAdd(c); }
  });
})();
