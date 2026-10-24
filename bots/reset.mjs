// Puts the demo back to its starting state; run it before every rehearsal:
// ETH at 1000, gas topped up, bots funded, any unfinished auction closed, and two identical
// open positions (1 WETH collateral, 800 mUSD debt) for ElifKlasik and ElifZarf.
// Also writes deployments/<chainId>.frontend.json (addresses, roles, ABIs) for the stage page.
import fs from "node:fs";
import path from "node:path";
import { maxUint256, parseEther, parseUnits, zeroHash } from "viem";
import { COLLATERAL, DEBT, DROP_PRICE, EXPLORER_TX_URL, GAS, ROOT, START_PRICE, fmt, log, read, send, setup, waitForBlock } from "./config.mjs";

const MIN_GAS = parseEther(process.env.MIN_GAS_MON ?? "0.3");
const TOPUP = parseEther(process.env.GAS_TOPUP_MON ?? "0.5");
// Monad can revert a MON transfer that leaves the sender below its reserve balance (about 10 MON).
const OWNER_RESERVE = parseEther(process.env.OWNER_RESERVE_MON ?? "10");
// Every commit locks the bid cap (900 at the demo price), so 3000 covers three auctions at once.
const BOT_MODULE_BALANCE = parseUnits("3000", 18);
const FAST_BOT_WALLET = parseUnits("3000", 18);

const PHASE = ["None", "Commit", "Reveal", "Settleable", "Settled", "AwaitingFallback", "FallbackLiquidated"];

const ctx = await setup();
const { contracts: c, addresses: addr, publicClient } = ctx;

log(`Zincir ${ctx.chainId}, KapaliZarf ${c.kz.address}`);
await ensurePrice();
await topUpGas();
for (const role of ["botA", "botB", "botC"]) await fundAuctionBot(role);
await fundFastBot();
await finishOpenAuction();
for (const role of ["elifKlasik", "elifZarf"]) await openPosition(role);
await printSummary();
writeFrontendFile();
log("Hazır. Şimdi npm run bots, sonra sahnede fiyat düşüşü.");

async function ensurePrice() {
  const price = await read(ctx, c.oracle, "price");
  if (price === START_PRICE) return;
  await send(ctx, "owner", c.oracle, "setPrice", [START_PRICE]);
  log(`ETH fiyatı ${fmt(price)} → ${fmt(START_PRICE)}`);
}

async function topUpGas() {
  for (const role of Object.keys(addr)) {
    if (role === "owner") continue;
    const balance = await publicClient.getBalance({ address: addr[role] });
    if (balance >= MIN_GAS) continue;
    const ownerBalance = await publicClient.getBalance({ address: addr.owner });
    if (ownerBalance < OWNER_RESERVE + TOPUP) {
      log(`UYARI: owner'da yeterli MON yok, ${role} doldurulamadı (${fmt(ownerBalance)} MON)`);
      continue;
    }
    const hash = await ctx.wallets.owner.sendTransaction({ to: addr[role], value: TOPUP, account: ctx.wallets.owner.account, chain: ctx.chain });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`${role} cüzdanına ${fmt(TOPUP)} MON gönderildi`);
  }
}

async function ensureAllowance(role, token, spender, amount) {
  const allowance = await read(ctx, token, "allowance", [addr[role], spender]);
  if (allowance < amount) await send(ctx, role, token, "approve", [spender, maxUint256]);
}

async function ensureWalletBalance(role, token, amount) {
  const balance = await read(ctx, token, "balanceOf", [addr[role]]);
  if (balance < amount) await send(ctx, role, token, "mint", [addr[role], amount - balance]);
}

async function fundAuctionBot(role) {
  const balance = await read(ctx, c.kz, "balanceOf", [addr[role]]);
  const locked = await read(ctx, c.kz, "lockedOf", [addr[role]]);
  const free = balance - locked;
  if (free >= BOT_MODULE_BALANCE) return;
  const need = BOT_MODULE_BALANCE - free;
  await ensureWalletBalance(role, c.usd, need);
  await ensureAllowance(role, c.usd, c.kz.address, need);
  await send(ctx, role, c.kz, "deposit", [need]);
  log(`${role}: KapaliZarf bakiyesine ${fmt(need)} mUSD yatırıldı`);
}

async function fundFastBot() {
  await ensureWalletBalance("fastBot", c.usd, FAST_BOT_WALLET);
  await ensureAllowance("fastBot", c.usd, c.pool.address, FAST_BOT_WALLET);
  await ensureAllowance("fastBot", c.usd, c.kz.address, FAST_BOT_WALLET);
}

/// A rehearsal stopped halfway leaves ElifZarf's collateral in an auction; close it first.
async function finishOpenAuction() {
  const id = await read(ctx, c.kz, "latestAuctionOf", [addr.elifZarf]);
  if (id === zeroHash) return;

  let phase = PHASE[await read(ctx, c.kz, "phaseOf", [id])];
  if (phase === "Commit" || phase === "Reveal") {
    const auction = await read(ctx, c.kz, "getAuction", [id]);
    log(`Yarım kalmış açık artırma var (${phase}), bitmesi bekleniyor`);
    await waitForBlock(ctx, auction.revealEnd + 1n);
    phase = "Settleable";
  }
  if (phase === "Settleable") {
    await send(ctx, "botC", c.kz, "settle", [id], GAS.settle);
    log("Yarım kalmış açık artırma kapatıldı");
    phase = PHASE[await read(ctx, c.kz, "phaseOf", [id])];
  }
  if (phase === "AwaitingFallback") {
    await send(ctx, "botA", c.kz, "fallbackLiquidate", [id], GAS.fallbackLiquidate);
    log("Teklifsiz açık artırma yedek yolla kapatıldı");
  }
}

async function openPosition(role) {
  const [collateral, debt, inAuction] = await read(ctx, c.pool, "positionOf", [addr[role]]);
  if (inAuction) {
    log(`UYARI: ${role} hâlâ açık artırmada, pozisyon açılmadı`);
    return;
  }
  if (debt > 0n) {
    log(`${role}: pozisyon zaten açık`);
    return;
  }
  if (collateral < COLLATERAL) {
    const missing = COLLATERAL - collateral;
    await ensureWalletBalance(role, c.weth, missing);
    await ensureAllowance(role, c.weth, c.pool.address, missing);
    await send(ctx, role, c.pool, "depositCollateral", [missing]);
  }
  await send(ctx, role, c.pool, "borrow", [DEBT]);
  log(`${role}: pozisyon açıldı (1 mWETH teminat, ${fmt(DEBT)} mUSD borç)`);
}

async function printSummary() {
  const price = await read(ctx, c.oracle, "price");
  const rows = {};
  for (const role of ["elifKlasik", "elifZarf"]) {
    const [collateral, debt, inAuction, value, hf] = await read(ctx, c.pool, "positionOf", [addr[role]]);
    rows[role] = {
      adres: addr[role],
      teminat: fmt(collateral),
      borç: fmt(debt),
      değer: fmt(value),
      sağlık: debt > 0n ? (Number(hf) / 1e18).toFixed(3) : "-",
      açıkArtırmada: inAuction,
    };
  }
  for (const role of ["botA", "botB", "botC"]) {
    const balance = await read(ctx, c.kz, "balanceOf", [addr[role]]);
    rows[role] = { adres: addr[role], modülBakiyesi: fmt(balance) };
  }
  rows.fastBot = { adres: addr.fastBot, cüzdan: fmt(await read(ctx, c.usd, "balanceOf", [addr.fastBot])) };
  console.log(`\nETH fiyatı: ${fmt(price)}`);
  console.table(rows);
}

function writeFrontendFile() {
  const file = path.join(ROOT, "deployments", `${ctx.chainId}.frontend.json`);
  const contracts = Object.fromEntries(
    Object.values(c).map((contract) => [contract.name, { address: contract.address, abi: contract.abi }]),
  );
  const data = {
    chainId: ctx.chainId,
    explorerTxUrl: EXPLORER_TX_URL,
    params: {
      startPrice: START_PRICE.toString(),
      dropPrice: DROP_PRICE.toString(),
      commitBlocks: ctx.deployment.commitBlocks,
      revealBlocks: ctx.deployment.revealBlocks,
    },
    roles: addr,
    contracts,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  log(`Sahne sayfası için ${path.relative(ROOT, file)} yazıldı`);
}
