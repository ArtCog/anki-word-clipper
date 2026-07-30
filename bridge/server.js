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
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 8770);
const SSH = process.env.HERMES_SSH || "-i ~/.ssh/id_ed25519_hetzner -o ConnectTimeout=15 root@91.98.164.161";

// model id -> how to invoke the CLI. The prompt always goes in on stdin, so
// nothing can break on quotes or newlines.
//
// mode explains how to read the answer back:
//   json        parse stdout as Claude Code's JSON envelope, take .result
//               (raw `claude -p` stdout also carries hook/output-style noise)
//   lastMessage read the file given to --output-last-message
//               (plain `codex exec` stdout carries a session banner + "tokens used")
//   raw         stdout is already clean
const BACKENDS = {
  "claude-haiku": { cmd: "claude", args: ["-p", "--output-format", "json", "--model", "haiku"], mode: "json" },
  "claude-sonnet": { cmd: "claude", args: ["-p", "--output-format", "json", "--model", "sonnet"], mode: "json" },
  "claude-opus": { cmd: "claude", args: ["-p", "--output-format", "json", "--model", "opus"], mode: "json" },
  codex: { cmd: "codex", args: ["exec"], mode: "lastMessage" },
  // no headless Antigravity on Windows: the agy-print wrapper lives on Hermes
  antigravity: { cmd: "ssh", args: [...SSH.split(/\s+/), "/root/.hermes/bin/agy-print"], mode: "raw" },
  gemini: { cmd: "gemini", args: [], mode: "raw" },
};

const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT || 120000);

// tolerate leading noise before the JSON envelope
function parseEnvelope(stdout) {
  const s = stdout.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`no JSON in output: ${s.slice(0, 200)}`);
  const d = JSON.parse(s.slice(start, end + 1));
  if (d.is_error) throw new Error(String(d.result || "CLI reported an error"));
  return String(d.result ?? "");
}

function runCli(id, prompt) {
  const b = BACKENDS[id];
  if (!b) return Promise.reject(new Error(`unknown model "${id}", try: ${Object.keys(BACKENDS).join(", ")}`));

  const outFile = b.mode === "lastMessage"
    ? path.join(os.tmpdir(), `awc-bridge-${process.pid}-${Date.now()}.txt`)
    : null;
  const args = outFile ? [...b.args, "--output-last-message", outFile] : b.args;

  return new Promise((resolve, reject) => {
    // shell:true is required on Windows, where these CLIs are .cmd shims
    const p = spawn(b.cmd, args, { shell: true, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${b.cmd} timed out after ${TIMEOUT_MS}ms`)); }, TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (b.mode === "lastMessage") {
          const text = fs.readFileSync(outFile, "utf8").trim();
          fs.unlink(outFile, () => {});
          if (!text) throw new Error(err.trim().slice(-400) || `${b.cmd} exited ${code} with empty answer`);
          return resolve(text);
        }
        if (code !== 0 && !out.trim()) throw new Error(err.trim().slice(-400) || `${b.cmd} exited ${code}`);
        resolve(b.mode === "json" ? parseEnvelope(out) : out.trim());
      } catch (e) {
        if (outFile) fs.unlink(outFile, () => {});
        reject(e);
      }
    });
    p.stdin.end(prompt);
  });
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
      const text = await runCli(id, prompt);
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
