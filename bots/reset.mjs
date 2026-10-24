// Puts the demo back to its starting state; run it before every rehearsal:
// ETH at 1000, gas topped up, bots funded, any unfinished auction closed, and two identical
// open positions (1 WETH collateral, 800 mUSD debt) for ElifKlasik and ElifZarf.
// Wallets work in parallel; each wallet's own transactions stay in order.
// Also writes the demo wallet addresses into shared/addresses*.json for the stage page.
//   npm run reset            (CLI)
//   POST localhost:8787/reset (from the bot process, see drop-server.mjs)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { maxUint256, parseEther, parseUnits, zeroHash } from "viem";
import { COLLATERAL, DEBT, GAS, ROOT, START_PRICE, addressesPath, fmt, log, read, send, setup, waitForBlock } from "./config.mjs";

const MIN_GAS = parseEther(process.env.MIN_GAS_MON ?? "1");
const TOPUP = parseEther(process.env.GAS_TOPUP_MON ?? "1.5");
// Monad can revert a MON transfer that leaves the sender below its reserve balance (about 10 MON).
const OWNER_RESERVE = parseEther(process.env.OWNER_RESERVE_MON ?? "10");
// Every commit locks the bid cap (900 at the demo price), so 3000 covers three auctions at once.
const BOT_MODULE_BALANCE = parseUnits("3000", 18);
const FAST_BOT_WALLET = parseUnits("3000", 18);

const PHASE = ["None", "Commit", "Reveal", "Settleable", "Settled", "AwaitingFallback", "FallbackLiquidated"];

export async function reset(ctx, { quiet = false } = {}) {
  const t0 = Date.now();
  const { contracts: c, addresses: addr, publicClient } = ctx;
  const say = (...parts) => quiet || log(...parts);

  const ensureAllowance = async (role, token, spender, amount) => {
    const allowance = await read(ctx, token, "allowance", [addr[role], spender]);
    if (allowance < amount) await send(ctx, role, token, "approve", [spender, maxUint256]);
  };

  const ensureWalletBalance = async (role, token, amount) => {
    const balance = await read(ctx, token, "balanceOf", [addr[role]]);
    if (balance < amount) await send(ctx, role, token, "mint", [addr[role], amount - balance]);
  };

  // Owner: price first, then MON top-ups (both from the owner's nonce, so sequential).
  const ownerWork = async () => {
    const price = await read(ctx, c.oracle, "price");
    if (price !== START_PRICE) {
      await send(ctx, "owner", c.oracle, "setPrice", [START_PRICE], GAS.setPrice);
      say(`ETH fiyatı ${fmt(price)} → ${fmt(START_PRICE)}`);
    }
    for (const role of Object.keys(addr)) {
      if (role === "owner") continue;
      const balance = await publicClient.getBalance({ address: addr[role] });
      if (balance >= MIN_GAS) continue;
      const ownerBalance = await publicClient.getBalance({ address: addr.owner });
      if (ownerBalance < OWNER_RESERVE + TOPUP) {
        say(`UYARI: owner'da yeterli MON yok, ${role} doldurulamadı (${fmt(ownerBalance)} MON)`);
        continue;
      }
      const hash = await ctx.wallets.owner.sendTransaction({ to: addr[role], value: TOPUP, account: ctx.accounts.owner, chain: ctx.chain });
      await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
      say(`${role} cüzdanına ${fmt(TOPUP)} MON gönderildi`);
    }
  };

  const fundAuctionBot = async (role) => {
    const balance = await read(ctx, c.kz, "balanceOf", [addr[role]]);
    const locked = await read(ctx, c.kz, "lockedOf", [addr[role]]);
    const free = balance - locked;
    if (free >= BOT_MODULE_BALANCE) return;
    const need = BOT_MODULE_BALANCE - free;
    await ensureWalletBalance(role, c.usd, need);
    await ensureAllowance(role, c.usd, c.kz.address, need);
    await send(ctx, role, c.kz, "deposit", [need]);
    say(`${role}: KapaliZarf bakiyesine ${fmt(need)} mUSD yatırıldı`);
  };

  const fundFastBot = async () => {
    await ensureWalletBalance("fastBot", c.usd, FAST_BOT_WALLET);
    await ensureAllowance("fastBot", c.usd, c.pool.address, FAST_BOT_WALLET);
    await ensureAllowance("fastBot", c.usd, c.kz.address, FAST_BOT_WALLET);
  };

  // A rehearsal stopped halfway leaves ElifZarf's collateral in an auction; close it first.
  // Uses Bot C, so it runs after Bot C's funding.
  const finishOpenAuction = async () => {
    const id = await read(ctx, c.kz, "latestAuctionOf", [addr.elifZarf]);
    if (id === zeroHash) return;

    let phase = PHASE[await read(ctx, c.kz, "phaseOf", [id])];
    if (phase === "Commit" || phase === "Reveal") {
      const auction = await read(ctx, c.kz, "getAuction", [id]);
      say(`Yarım kalmış açık artırma var (${phase}), bitmesi bekleniyor`);
      await waitForBlock(ctx, auction.revealEnd + 1n);
      phase = "Settleable";
    }
    if (phase === "Settleable") {
      await send(ctx, "botC", c.kz, "settle", [id], GAS.settle);
      say("Yarım kalmış açık artırma kapatıldı");
      phase = PHASE[await read(ctx, c.kz, "phaseOf", [id])];
    }
    if (phase === "AwaitingFallback") {
      await send(ctx, "botC", c.kz, "fallbackLiquidate", [id], GAS.fallbackLiquidate);
      say("Teklifsiz açık artırma yedek yolla kapatıldı");
    }
  };

  const openPosition = async (role) => {
    const [collateral, debt, inAuction] = await read(ctx, c.pool, "positionOf", [addr[role]]);
    if (inAuction) {
      say(`UYARI: ${role} hâlâ açık artırmada, pozisyon açılmadı`);
      return;
    }
    if (debt > 0n) {
      say(`${role}: pozisyon zaten açık`);
      return;
    }
    if (collateral < COLLATERAL) {
      const missing = COLLATERAL - collateral;
      await ensureWalletBalance(role, c.weth, missing);
      await ensureAllowance(role, c.weth, c.pool.address, missing);
      await send(ctx, role, c.pool, "depositCollateral", [missing]);
    }
    await send(ctx, role, c.pool, "borrow", [DEBT]);
    say(`${role}: pozisyon açıldı (1 mWETH teminat, ${fmt(DEBT)} mUSD borç)`);
  };

  say(`Zincir ${ctx.chainId}, KapaliZarf ${c.kz.address}`);
  // Gas first (a fresh wallet cannot send anything), then the price must be back at 1000 before the
  // Elifs borrow and the leftover auction closed before ElifZarf reopens; the rest runs side by side.
  await ownerWork();
  await Promise.all([
    fundAuctionBot("botA"),
    fundAuctionBot("botB"),
    fundAuctionBot("botC").then(finishOpenAuction),
    fundFastBot(),
  ]);
  await Promise.all([openPosition("elifKlasik"), openPosition("elifZarf")]);

  const summary = await printSummary(ctx, quiet);
  writeRoles(ctx);
  say(`Hazır (${((Date.now() - t0) / 1000).toFixed(1)} sn). Şimdi npm run bots, sonra sahnede fiyat düşüşü.`);
  return summary;
}

async function printSummary(ctx, quiet) {
  const { contracts: c, addresses: addr } = ctx;
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
    const balance = await read(ctx, c.kz, "freeBalanceOf", [addr[role]]);
    rows[role] = { adres: addr[role], serbestBakiye: fmt(balance) };
  }
  rows.fastBot = { adres: addr.fastBot, cüzdan: fmt(await read(ctx, c.usd, "balanceOf", [addr.fastBot])) };
  if (!quiet) {
    console.log(`\nETH fiyatı: ${fmt(price)}`);
    console.table(rows);
  }
  return { price: fmt(price), rows };
}

/// The deploy may have run before the demo wallets existed; keep the address file's roles current.
function writeRoles(ctx) {
  const file = addressesPath(ctx.chainId);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const { addresses: addr } = ctx;
  const next = {
    ...data,
    owner: addr.owner,
    elifKlasik: addr.elifKlasik,
    elifZarf: addr.elifZarf,
    bots: { a: addr.botA, b: addr.botB, c: addr.botC, fast: addr.fastBot },
  };
  if (JSON.stringify(next) === JSON.stringify(data)) return;
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  log(`${path.relative(ROOT, file)} cüzdan adresleriyle güncellendi`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reset(await setup());
}
