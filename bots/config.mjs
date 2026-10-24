// Shared setup for reset, drop and the bot process.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatUnits,
  http,
  parseEventLogs,
  parseGwei,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: process.env.ENV_FILE ?? path.join(ROOT, ".env"), quiet: true });

export const MONAD_TESTNET = 10143;
export const RPC_URL = process.env.RPC_URL || process.env.MONAD_TESTNET_RPC;
export const WS_URL = process.env.WS_URL || process.env.MONAD_TESTNET_WSS || RPC_URL?.replace(/^http/, "ws");
export const POLL_MS = Number(process.env.POLL_MS ?? 200);
export const DROP_PORT = Number(process.env.DROP_PORT ?? 8787);
export const EXPLORER_TX_URL = process.env.EXPLORER_TX_URL ?? "https://testnet.monadvision.com/tx/";
// Tip on top of twice the base fee. Monad charges the gas limit, not the gas used.
export const PRIORITY_FEE = parseGwei(process.env.PRIORITY_GWEI ?? "2");

export const START_PRICE = parseUnits("1000", 18);
export const DROP_PRICE = parseUnits(process.env.DROP_PRICE ?? "900", 18);
export const COLLATERAL = parseUnits("1", 18);
export const DEBT = parseUnits("800", 18);

// Fixed gas limits (roadmap decision 2): one estimateGas round trip less per transaction.
// forge --gas-report max + 21k intrinsic, x1.5 for Monad's repriced cold storage access.
// Re-measure after the first testnet run and tighten.
export const GAS = {
  setPrice: 80_000n,
  startAuction: 450_000n,
  commit: 215_000n,
  reveal: 220_000n,
  settle: 380_000n,
  liquidateClassic: 195_000n,
  fallbackLiquidate: 340_000n,
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

// Context key -> [contract name, key in shared/addresses.json]
const CONTRACTS = {
  usd: ["MockUSD", "usd"],
  weth: ["MockWETH", "weth"],
  oracle: ["MockOracle", "oracle"],
  pool: ["LendingPool", "pool"],
  kz: ["KapaliZarf", "zarf"],
};

export const addressesPath = (chainId) =>
  path.join(ROOT, "shared", chainId === MONAD_TESTNET ? "addresses.json" : `addresses.${chainId}.json`);

export async function setup() {
  if (!RPC_URL) fail("RPC_URL ya da MONAD_TESTNET_RPC .env'de tanımlı değil.");

  const chainId = await createPublicClient({ transport: http(RPC_URL) }).getChainId();
  const chain = defineChain({
    id: chainId,
    name: chainId === MONAD_TESTNET ? "Monad Testnet" : `Chain ${chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 100 });

  const file = addressesPath(chainId);
  if (!fs.existsSync(file)) fail(`${path.relative(ROOT, file)} yok. Önce npm run deploy çalıştırın.`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));

  const contracts = {};
  for (const [key, [name, field]] of Object.entries(CONTRACTS)) {
    contracts[key] = { name, address: deployment[field], abi: loadAbi(name) };
  }

  const accounts = {};
  const wallets = {};
  const addresses = {};
  for (const [role, envKey] of Object.entries(ROLES)) {
    const raw = process.env[envKey];
    if (!raw) fail(`${envKey} .env'de yok. npm run wallets ile oluşturun.`);
    const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
    accounts[role] = account;
    wallets[role] = createWalletClient({ account, chain, transport: http(RPC_URL) });
    addresses[role] = account.address;
  }

  return { chainId, chain, publicClient, deployment, contracts, accounts, wallets, addresses };
}

function loadAbi(name) {
  const file = path.join(ROOT, "shared", "abi", `${name}.json`);
  if (!fs.existsSync(file)) fail(`${path.relative(ROOT, file)} yok. Önce npm run abi çalıştırın.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/// Every ABI merged, for decoding logs from any of the five contracts.
export function allAbis(ctx) {
  return Object.values(ctx.contracts).flatMap((c) => c.abi);
}

export function read(ctx, contract, functionName, args = []) {
  return ctx.publicClient.readContract({ address: contract.address, abi: contract.abi, functionName, args });
}

/// Sends a write from `role`, waits for the receipt and returns it with the contract's decoded events.
/// For setup work (reset, drop); the bots use createSender, which never waits.
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

/// Current fees: twice the latest base fee plus a small fixed tip. Refreshed by the bot process.
export async function currentFees(ctx) {
  const block = await ctx.publicClient.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? parseGwei("50");
  return { maxFeePerGas: base * 2n + PRIORITY_FEE, maxPriorityFeePerGas: PRIORITY_FEE };
}

/// Fast path for the bots: signs locally with a tracked nonce, fixed gas and cached fees, and makes a
/// single eth_sendRawTransaction call. Never waits for a receipt; the outcome arrives as an event.
export async function createSender(ctx, role, fees) {
  const account = ctx.accounts[role];
  const sender = {
    role,
    address: account.address,
    nonce: 0,
    async sync() {
      sender.nonce = await ctx.publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    },
    async send(contract, functionName, args) {
      const nonce = sender.nonce++;
      const serializedTransaction = await account.signTransaction({
        chainId: ctx.chainId,
        type: "eip1559",
        to: contract.address,
        data: encodeFunctionData({ abi: contract.abi, functionName, args }),
        nonce,
        gas: GAS[functionName],
        ...fees.current,
      });
      try {
        return await ctx.publicClient.sendRawTransaction({ serializedTransaction });
      } catch (err) {
        await sender.sync().catch(() => {});
        throw err;
      }
    },
  };
  await sender.sync();
  return sender;
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
