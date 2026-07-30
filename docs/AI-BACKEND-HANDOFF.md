# Handoff: подключение «умной» модели к переводу

Контекст для агента, который будет это делать. Составлено 2026-07-30.

## Что уже есть

`translator.js` умеет три движка: `google` | `deepl` | `ai`.
Движок `ai` — **любой OpenAI-совместимый endpoint** (`POST {baseUrl}/chat/completions`,
`Authorization: Bearer <apiKey>`), см. `buildAiRequest()`. Сейчас Артур сидит на
бесплатном ключе **Gemini 2.5 Flash** через OpenAI-совместимый шлюз Google.

Промпт — `AI_SYSTEM_PROMPT` (translator.js:41). Возвращает строгий JSON:
`headword` / `forms` / `translation` / `note` (+ `example` по флагу).

## Чего хочет Артур

Задействовать «свои ключи»: **Antigravity** и **Codex (ChatGPT-подписка)**.

## Факт, который меняет постановку

**Ни то, ни другое не является HTTP API.** Это CLI-инструменты:
- Antigravity → `agy` (обёртка `/root/.hermes/bin/agy-print` на сервере Hermes)
- Codex → `codex exec`, авторизация OAuth-токенами ChatGPT-подписки
  (`~/.codex/auth.json`, поле `OPENAI_API_KEY: null` — API-ключа там нет)

Расширение MV3 не может запускать процессы. Значит «вставить ключ в поле»
невозможно — нужен посредник. Раньше в этом проекте фиксировали «подписки
подключить нельзя»; уточнение: **нельзя напрямую, но можно через локальный мост** —
такой мост уже работает в другом проекте Артура (`ai_news/run.py` зовёт
`codex-print` как LLM-фолбэк).

## Вариант A (рекомендуемый): не менять бэкенд

Проблема, из-за которой всё затевалось (см. ниже — устойчивые выражения),
**не в модели, а в промпте**. Плюс текущий ключ Gemini позволяет взять модель
поновее без единой строчки кода — просто поменять `model` в настройках:
`gemini-2.5-flash` → `gemini-3.6-flash`. Бесплатно, ответ <1 c.

CLI-мост для перевода слова плох по скорости: `codex exec` поднимает агентную
сессию, это **10–20 секунд на слово** против <1 c у API. Для «выделил → карточка»
это неприемлемо.

## Вариант B: локальный мост CLI → HTTP (если Артур настаивает)

Маленький сервер на машине Артура, говорящий на диалекте OpenAI:

```js
// bridge.js — node bridge.js, слушает 127.0.0.1:8788
const http = require("http");
const { execFile } = require("child_process");

http.createServer((req, res) => {
  // расширение шлёт стандартный /chat/completions
  if (!req.url.endsWith("/chat/completions")) { res.writeHead(404).end(); return; }
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    const msgs = JSON.parse(body).messages || [];
    const prompt = msgs.map(m => `${m.role}: ${m.content}`).join("\n\n");
    // ВАЖНО: --output-last-message, иначе в stdout попадут баннер сессии
    // и строка "tokens used" — JSON перестанет парситься
    const out = require("os").tmpdir() + "/bridge-" + Date.now() + ".txt";
    execFile("codex", [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check",
      "--color", "never", "--output-last-message", out, "-",
    ], { input: prompt, timeout: 120000 }, () => {
      const text = require("fs").readFileSync(out, "utf8").trim();
      require("fs").unlinkSync(out);
      res.writeHead(200, {
        "Content-Type": "application/json",
        // MV3 fetch с расширения — нужен CORS
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    });
  });
}).listen(8788, "127.0.0.1");
```

В настройках расширения: `baseUrl = http://127.0.0.1:8788/v1`, `apiKey` — пустой.
Плюс в `manifest.json` понадобится `host_permissions` на `http://127.0.0.1:8788/*`.

Ограничения, которые надо честно сказать Артуру: работает только когда мост
запущен; 10–20 c на слово; ChatGPT-подписка не предназначена для программного
доступа сторонними клиентами — для личного использования это его решение.

## Настоящая проблема (то, ради чего всё затевалось)

Артур выделяет часть устойчивой конструкции (пример: `weder … noch`), а модель
возвращает **одно слово без конструкции** — ни в headword, ни в переводе.

Причина в `AI_SYSTEM_PROMPT`: он описывает «слово или фраза как она встречается
в предложении», но нигде не сказано, что делать, если выделенное — **часть
многословной единицы** (парный союз, разделяемый глагол с приставкой, идиома,
устойчивое сочетание глагол+предлог).

Что добавить в промпт (правка одной строки, работает на любой модели):

> If the highlighted word is part of a multi-word lexical unit visible in the
> sentence — a correlative conjunction (`weder … noch`, `sowohl … als auch`), a
> separable verb with its prefix (`ruft … an`), a fixed verb+preposition
> collocation or an idiom — set `headword` to the ENTIRE unit in dictionary form
> and translate the unit as a whole, not the highlighted fragment alone.

Проверять на: `weder … noch`, `Er ruft mich morgen an`, `es kommt darauf an`,
`sowohl … als auch`.

## Порядок действий

1. Добавить правило про многословные единицы в `AI_SYSTEM_PROMPT` + тесты
   (`node --test tests/*.test.js`, там уже 29 штук — добавить кейсы выше).
2. Переключить модель на `gemini-3.6-flash`, сравнить на тех же примерах.
3. Мост (вариант B) — только если после 1–2 качество всё ещё не устраивает.

## Ограничения окружения (важно, обжигались)

- PowerShell запрещён deny-правилом: иконки через ffmpeg (`scripts/make-icons.sh`),
  zip через `C:\Windows\System32\tar.exe -a`.
- Zero-build: чистая логика в classic-скриптах с `module.exports`-хвостом.
- JSON из Python на Windows писать ТОЛЬКО с `encoding='utf-8'` — иначе cp1251
  убивает кириллицу в файле.
