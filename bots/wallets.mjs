// Creates the seven demo wallets (two Elifs, four bots, the presenter's own bidder "Sen") and
// appends their keys to .env.
// Existing keys are never overwritten. DEPLOYER_PK is yours: a wallet funded from the Monad faucet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENV_FILE ?? path.join(ROOT, ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

const ROLES = [
  ["ELIF_KLASIK_PK", "ElifKlasik"],
  ["ELIF_ZARF_PK", "ElifZarf"],
  ["BOT_A_PK", "Bot A"],
  ["BOT_B_PK", "Bot B"],
  ["BOT_C_PK", "Bot C"],
  ["FAST_BOT_PK", "Hızlı Bot"],
  ["GUEST_PK", "Sen"],
];

const lines = [];
for (const [key, label] of ROLES) {
  if (new RegExp(`^${key}=`, "m").test(existing)) {
    console.log(`${label.padEnd(11)} zaten var, dokunulmadı`);
    continue;
  }
  const pk = generatePrivateKey();
  lines.push(`${key}=${pk}`);
  console.log(`${label.padEnd(11)} ${privateKeyToAccount(pk).address}`);
}

if (lines.length > 0) {
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(envPath, `${prefix}\n# Demo wallets (testnet only), created by npm run wallets\n${lines.join("\n")}\n`);
  console.log(`\n${lines.length} anahtar ${envPath} dosyasına eklendi.`);
}

if (!/^DEPLOYER_PK=/m.test(existing)) {
  console.log("\nDEPLOYER_PK yok: faucet'ten MON aldığınız cüzdanın anahtarını .env'e ekleyin.");
}
