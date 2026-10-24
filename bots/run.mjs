// The demo's four bots in one process:
//   Hızlı Bot  liquidates ElifKlasik the classic way as soon as she becomes liquidatable.
//   Bot A      starts ElifZarf's auction (anyone may) and then bids like the others.
//   Bot A/B/C  commit a sealed bid, reveal it once the commit window closes; Bot C settles.
// A bid is the collateral value minus the bot's margin, rounded down to a whole mUSD.
// At ETH 900 that gives 890, 885 and 870: the numbers in the project document.
import { randomBytes } from "node:crypto";
import { encodeAbiParameters, keccak256, parseUnits, zeroHash } from "viem";
import { GAS, POLL_MS, fmt, log, read, send, setup, sleep, txLink, waitForBlock } from "./config.mjs";

const BIDDERS = [
  { role: "botA", label: "Bot A", marginBps: 111n },
  { role: "botB", label: "Bot B", marginBps: 166n },
  { role: "botC", label: "Bot C", marginBps: 333n },
];
const ONE = parseUnits("1", 18);
const ACTIVE = 1; // KapaliZarf.Status.Active
const COMMIT_PHASE = 1; // KapaliZarf.Phase.Commit

const ctx = await setup();
const { contracts: c, addresses: addr } = ctx;
const labels = {
  [addr.botA]: "Bot A",
  [addr.botB]: "Bot B",
  [addr.botC]: "Bot C",
  [addr.fastBot]: "Hızlı Bot",
};

const busy = { classic: false, start: false };
const handled = new Set();
let lastPrice = -1n;
let tick = 0;

log(`Botlar çalışıyor. Zincir ${ctx.chainId}, KapaliZarf ${c.kz.address}`);
log(`ElifKlasik ${addr.elifKlasik} | ElifZarf ${addr.elifZarf}`);

// An auction left over from an earlier run is joined only if bids are still open.
const leftover = await read(ctx, c.kz, "latestAuctionOf", [addr.elifZarf]);
if (leftover !== zeroHash && (await read(ctx, c.kz, "phaseOf", [leftover])) !== COMMIT_PHASE) {
  handled.add(leftover);
}

for (;;) {
  try {
    await poll();
  } catch (err) {
    log("Hata:", err.shortMessage ?? err.message);
  }
  await sleep(POLL_MS);
}

async function poll() {
  tick += 1;
  const [price, latest] = await Promise.all([
    read(ctx, c.oracle, "price"),
    read(ctx, c.kz, "latestAuctionOf", [addr.elifZarf]),
  ]);

  // An auction started by someone else (for example the stage page) is joined here.
  if (latest !== zeroHash && !handled.has(latest)) handle(latest);

  const priceChanged = price !== lastPrice;
  if (priceChanged && lastPrice !== -1n) log(`ETH fiyatı ${fmt(lastPrice)} → ${fmt(price)}`);
  lastPrice = price;
  if (!priceChanged && tick % 10 !== 0) return;

  const [klasikLiquidatable, zarfLiquidatable] = await Promise.all([
    read(ctx, c.pool, "isLiquidatable", [addr.elifKlasik]),
    read(ctx, c.pool, "isLiquidatable", [addr.elifZarf]),
  ]);
  // Not awaited: both liquidations start in the same tick.
  if (klasikLiquidatable && !busy.classic) liquidateClassic();
  if (zarfLiquidatable && !busy.start) startAuction();
}

async function liquidateClassic() {
  busy.classic = true;
  const t0 = Date.now();
  try {
    const { hash, events } = await send(ctx, "fastBot", c.pool, "liquidateClassic", [addr.elifKlasik], GAS.liquidateClassic);
    const { price, refund } = events.find((e) => e.eventName === "ClassicLiquidated").args;
    log(`KLASİK: Hızlı Bot sabit indirimle aldı. Ödenen ${fmt(price)}, Elif'e dönen ${fmt(refund)} (${since(t0)})  ${txLink(hash)}`);
  } catch (err) {
    log("Hızlı Bot:", err.shortMessage ?? err.message);
  } finally {
    busy.classic = false;
  }
}

async function startAuction() {
  busy.start = true;
  const t0 = Date.now();
  try {
    const { hash, events } = await send(ctx, "botA", c.pool, "startAuction", [addr.elifZarf], GAS.startAuction);
    const { auctionId } = events.find((e) => e.eventName === "LiquidationAuctionStarted").args;
    log(`Bot A, ElifZarf için açık artırmayı başlattı  ${txLink(hash)}`);
    handle(auctionId, t0);
  } catch (err) {
    log("Bot A (başlatma):", err.shortMessage ?? err.message);
  } finally {
    busy.start = false;
  }
}

async function handle(id, t0 = Date.now()) {
  if (handled.has(id)) return;
  handled.add(id);

  const auction = await read(ctx, c.kz, "getAuction", [id]);
  if (auction.status !== ACTIVE) return;
  log(
    `Açık artırma ${id.slice(0, 10)}: taban ${fmt(auction.reservePrice)}, üst sınır ${fmt(auction.bidCap)}, ` +
      `teklif ≤ blok ${auction.commitEnd}, açıklama ≤ blok ${auction.revealEnd}`,
  );

  // 1. Sealed bids, all three at once.
  const committed = [];
  await Promise.all(
    BIDDERS.map(async (bot) => {
      const amount = ((auction.bidCap * (10_000n - bot.marginBps)) / 10_000n / ONE) * ONE;
      if (amount < auction.reservePrice) {
        log(`${bot.label}: teklifi tabanın altında kalıyor, katılmıyor`);
        return;
      }
      const salt = `0x${randomBytes(32).toString("hex")}`;
      try {
        const { hash } = await send(ctx, bot.role, c.kz, "commit", [id, commitHash(id, amount, salt, addr[bot.role])], GAS.commit);
        committed.push({ ...bot, amount, salt });
        log(`${bot.label}: mühürlü teklif verildi  ${txLink(hash)}`);
      } catch (err) {
        log(`${bot.label} (teklif):`, err.shortMessage ?? err.message);
      }
    }),
  );

  // 2. Open the envelopes once the commit window has closed.
  await waitForBlock(ctx, auction.commitEnd + 1n);
  await Promise.all(
    committed.map(async (bot) => {
      try {
        const { hash } = await send(ctx, bot.role, c.kz, "reveal", [id, bot.amount, bot.salt], GAS.reveal);
        log(`${bot.label}: zarf açıldı, teklif ${fmt(bot.amount)}  ${txLink(hash)}`);
      } catch (err) {
        log(`${bot.label} (açıklama):`, err.shortMessage ?? err.message);
      }
    }),
  );

  // 3. Settle once the reveal window has closed; fall back if nobody bid.
  await waitForBlock(ctx, auction.revealEnd + 1n);
  try {
    const { hash, events } = await send(ctx, "botC", c.kz, "settle", [id], GAS.settle);
    const settled = events.find((e) => e.eventName === "AuctionSettled");
    if (settled) {
      const { winner, price, refund } = settled.args;
      log(`KAPALI ZARF: kazanan ${labels[winner] ?? winner}, ödenen ikinci fiyat ${fmt(price)}, Elif'e dönen ${fmt(refund)} (${since(t0)})  ${txLink(hash)}`);
      return;
    }
    log("Geçerli teklif yok, Bot A yedek yolla likide ediyor");
    const fallback = await send(ctx, "botA", c.kz, "fallbackLiquidate", [id], GAS.fallbackLiquidate);
    const { price, refund } = fallback.events.find((e) => e.eventName === "FallbackLiquidated").args;
    log(`YEDEK: taban fiyat ${fmt(price)}, Elif'e dönen ${fmt(refund)}  ${txLink(fallback.hash)}`);
  } catch (err) {
    log("Bot C (sonuç):", err.shortMessage ?? err.message);
  }
}

/// Same as KapaliZarf.commitHashOf: keccak256(abi.encode(id, amount, salt, bidder)).
function commitHash(id, amount, salt, bidder) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" }],
      [id, amount, salt, bidder],
    ),
  );
}

function since(t0) {
  return `${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} sn`;
}
