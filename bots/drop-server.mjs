// Local control endpoint for the stage page (roadmap decision 7: no MetaMask on stage).
// The owner key stays in the bot process; the browser only calls localhost.
//   GET  /health  -> { ok, chainId, head, busy }
//   POST /drop    -> owner sets the ETH price (body { "price": 900 } optional)
//   POST /reset   -> runs the reset; bots pause while it runs
import http from "node:http";
import { log } from "./config.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Lets an HTTPS page (Vercel) reach localhost in Chrome.
  "Access-Control-Allow-Private-Network": "true",
};

export function startDropServer({ port, health, drop, reset }) {
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    };
    if (req.method === "OPTIONS") return reply(204, {});

    try {
      if (req.method === "GET" && req.url === "/health") return reply(200, await health());
      if (req.method === "POST" && req.url === "/drop") return reply(200, await drop(await body(req)));
      if (req.method === "POST" && req.url === "/reset") return reply(200, await reset());
      return reply(404, { ok: false, error: "not found" });
    } catch (err) {
      log(`drop-server ${req.url}:`, err.shortMessage ?? err.message);
      return reply(500, { ok: false, error: err.shortMessage ?? err.message });
    }
  });
  server.listen(port, "127.0.0.1", () => log(`Sahne uç noktası http://localhost:${port} (/health, /drop, /reset)`));
  return server;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
