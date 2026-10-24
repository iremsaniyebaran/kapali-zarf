// Copies the five ABIs from forge's out/ into shared/abi/ for the bots and the stage page.
// Runs after every deploy (npm run deploy) and on its own with npm run abi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = ["MockUSD", "MockWETH", "MockOracle", "LendingPool", "KapaliZarf"];
const outDir = path.join(ROOT, "shared", "abi");
fs.mkdirSync(outDir, { recursive: true });

for (const name of CONTRACTS) {
  const artifact = path.join(ROOT, "out", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifact)) {
    console.error(`Hata: ${artifact} yok. Önce forge build çalıştırın.`);
    process.exit(1);
  }
  const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(abi, null, 2)}\n`);
  console.log(`shared/abi/${name}.json`);
}
