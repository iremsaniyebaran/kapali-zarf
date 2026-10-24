// Shared setup for reset, drop and the bot process.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseEventLogs,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: process.env.ENV_FILE ?? path.join(ROOT, ".env") });

export const RPC_URL = process.env.RPC_URL || process.env.MONAD_TESTNET_RPC;
export const POLL_MS = Number(process.env.POLL_MS ?? 200);
export const EXPLORER_TX_URL = process.env.EXPLORER_TX_URL ?? "https://testnet.monadscan.com/tx/";

export const START_PRICE = parseUnits("1000", 18);
export const DROP_PRICE = parseUnits(process.env.DROP_PRICE ?? "900", 18);
export const COLLATERAL = parseUnits("1", 18);
export const DEBT = parseUnits("800", 18);

// Gas limits measured in the Foundry tests, plus 20%. Re-measure on Monad testnet with estimateGas.
export const GAS = {
  startAuction: 345_000n,
  commit: 145_000n,
  reveal: 150_000n,
  settle: 340_000n,
  liquidateClassic: 135_000n,
  fallbackLiquidate: 240_000n,
};

// Role -> .env key. The owner deploys, moves the oracle price and tops up gas.
export const ROLES = {
  owner: "DEPLOYER_PK",
  elifKlasik: "ELIF_KLASIK_PK",
  elifZarf: "ELIF_ZARF_PK",
  botA: "BOT_A_PK",
  botB: "BOT_B_PK",
  botC: "BOT_C_PK",
  fastBot: "FAST_BOT_PK",
};

const CONTRACTS = {
  usd: "MockUSD",
  weth: "MockWETH",
  oracle: "MockOracle",
  pool: "LendingPool",
  kz: "KapaliZarf",
};

export async function setup() {
  if (!RPC_URL) fail("RPC_URL ya da MONAD_TESTNET_RPC .env'de tanımlı değil.");

  const chainId = await createPublicClient({ transport: http(RPC_URL) }).getChainId();
  const chain = defineChain({
    id: chainId,
    name: chainId === 10143 ? "Monad Testnet" : `Chain ${chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 100 });

  const deploymentPath = path.join(ROOT, "deployments", `${chainId}.json`);
  if (!fs.existsSync(deploymentPath)) fail(`${deploymentPath} yok. Önce npm run deploy çalıştırın.`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const contracts = {};
  for (const [key, name] of Object.entries(CONTRACTS)) {
    contracts[key] = { name, address: deployment[name], abi: loadAbi(name) };
  }

  const wallets = {};
  const addresses = {};
  for (const [role, envKey] of Object.entries(ROLES)) {
    const raw = process.env[envKey];
    if (!raw) fail(`${envKey} .env'de yok. npm run wallets ile oluşturun.`);
    const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
    wallets[role] = createWalletClient({ account, chain, transport: http(RPC_URL) });
    addresses[role] = account.address;
  }

  return { chainId, chain, publicClient, deployment, contracts, wallets, addresses };
}

function loadAbi(name) {
  const file = path.join(ROOT, "out", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) fail(`${file} yok. Önce forge build çalıştırın.`);
  return JSON.parse(fs.readFileSync(file, "utf8")).abi;
}

export function read(ctx, contract, functionName, args = []) {
  return ctx.publicClient.readContract({ address: contract.address, abi: contract.abi, functionName, args });
}

/// Sends a write from `role`, waits for the receipt and returns it with the contract's decoded events.
export async function send(ctx, role, contract, functionName, args, gas) {
  const wallet = ctx.wallets[role];
  const hash = await wallet.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
    gas,
    account: wallet.account,
    chain: ctx.chain,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  if (receipt.status !== "success") throw new Error(`${role} ${functionName} revert etti: ${txLink(hash)}`);
  const events = parseEventLogs({ abi: contract.abi, logs: receipt.logs });
  return { hash, receipt, events };
}

export async function waitForBlock(ctx, target) {
  while ((await ctx.publicClient.getBlockNumber()) < target) await sleep(100);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const fmt = (wei) => Number(formatUnits(wei, 18)).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
export const txLink = (hash) => `${EXPLORER_TX_URL}${hash}`;
export const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

export function fail(message) {
  console.error(`Hata: ${message}`);
  process.exit(1);
}
