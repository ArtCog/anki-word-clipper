#!/usr/bin/env node
// Local OpenAI-compatible bridge over the agent CLIs you are already logged
// into (Claude Code, Codex, Gemini CLI). Lets the extension use your monthly
// subscriptions instead of a pay-per-token API key.
//
//   node bridge/server.js            # listens on http://localhost:8770/v1
//
// In the extension popup: engine "ИИ" -> provider "Свой", base URL
// http://localhost:8770/v1, model one of the ids below, API key empty.
//
// ponytail: no deps, no streaming, no auth. It binds to 127.0.0.1 only,
// so nothing outside this machine can reach it.

const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 8770);

// model id -> how to invoke the CLI. Prompt always goes in via stdin, so no
// shell escaping can break on quotes or newlines.
const BACKENDS = {
  "claude-haiku": { cmd: "claude", args: ["-p", "--model", "haiku"] },
  "claude-sonnet": { cmd: "claude", args: ["-p", "--model", "sonnet"] },
  "claude-opus": { cmd: "claude", args: ["-p", "--model", "opus"] },
  codex: { cmd: "codex", args: ["exec"] },
  gemini: { cmd: "gemini", args: [] },
};

const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT || 90000);

function runCli(id, prompt) {
  const b = BACKENDS[id];
  if (!b) return Promise.reject(new Error(`unknown model "${id}", try: ${Object.keys(BACKENDS).join(", ")}`));
  return new Promise((resolve, reject) => {
    // shell:true is required on Windows, where these CLIs are .cmd shims
    const p = spawn(b.cmd, b.args, { shell: true, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${b.cmd} timed out after ${TIMEOUT_MS}ms`)); }, TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error(err.trim().slice(-400) || `${b.cmd} exited ${code}`));
      resolve(out.trim());
    });
    p.stdin.end(prompt);
  });
}

// Codex prints a run header/footer around the answer; keep only the payload.
function cleanup(text, id) {
  if (id !== "codex") return text;
  const lines = text.split("\n").filter((l) => !/^\[?\d{4}-\d{2}-\d{2}|^(workdir|model|provider|approval|sandbox|reasoning|tokens used|--------)/i.test(l.trim()));
  return lines.join("\n").trim();
}

const flatten = (messages) =>
  (messages || []).map((m) => (m.role === "system" ? m.content : `${m.content}`)).join("\n\n");

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" });
    return res.end();
  }
  if (req.method === "GET" && req.url.endsWith("/models")) {
    return send(res, 200, { object: "list", data: Object.keys(BACKENDS).map((id) => ({ id, object: "model" })) });
  }
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    return send(res, 404, { error: { message: "POST /v1/chat/completions" } });
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { message: "bad JSON" } }); }
    const id = body.model || "claude-haiku";
    const prompt = flatten(body.messages);
    const started = Date.now();
    try {
      const text = cleanup(await runCli(id, prompt), id);
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${id} ok in ${Date.now() - started}ms`);
      send(res, 200, {
        id: `bridge-${started}`,
        object: "chat.completion",
        model: id,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
      });
    } catch (e) {
      console.error(`[${new Date().toISOString().slice(11, 19)}] ${id} FAILED: ${e.message}`);
      send(res, 502, { error: { message: String(e.message || e) } });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Anki Word Clipper bridge: http://localhost:${PORT}/v1`);
  console.log(`Модели: ${Object.keys(BACKENDS).join(", ")}`);
  console.log("В попапе расширения: провайдер «Свой», ключ оставить пустым.");
});
