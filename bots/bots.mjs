// The demo's four bots in one process, driven by early chain events (ws.mjs):
//   Hızlı Bot  liquidates ElifKlasik the classic way the moment the price makes her liquidatable.
//   Bot A      starts ElifZarf's auction (anyone may) and then bids like the others.
//   Bot A/B/C  commit a sealed bid, reveal it when the commit window closes; Bot C settles.
// A bid is the collateral value minus the bot's margin, rounded down to a whole mUSD.
// At ETH 900 that gives 890, 885 and 870: the numbers in the project document.
//
// Speed comes from three things: hearing events early (monadLogs), signing locally and sending with
// one RPC call (createSender), and never waiting for a receipt.
// The same process serves POST /drop and /reset for the stage page (drop-server.mjs).
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decodeEventLog, encodeAbiParameters, keccak256, parseUnits, zeroHash } from "viem";
import {
  DROP_PORT,
  DROP_PRICE,
  ROOT,
  WS_URL,
  allAbis,
  createSender,
  currentFees,
  fail,
  fmt,
  log,
  read,
  setup,
  txLink,
} from "./config.mjs";
import { startFeed } from "./ws.mjs";
import { startDropServer } from "./drop-server.mjs";
import { reset } from "./reset.mjs";

const BIDDERS = [
  { role: "botA", label: "Bot A", marginBps: 111n },
  { role: "botB", label: "Bot B", marginBps: 166n },
  { role: "botC", label: "Bot C", marginBps: 333n },
];
const ONE = parseUnits("1", 18);
const ACTIVE = 1; // KapaliZarf.Status.Active
const LIQ_THRESHOLD_BPS = 8_500n; // LendingPool.LIQ_THRESHOLD_BPS
const STATE_DIR = path.join(ROOT, "bots", "state");
// A liquidation sent but not yet seen on chain is not sent again for this long.
const RESEND_AFTER_MS = 5_000;

const ctx = await setup();
const { contracts: c, addresses: addr } = ctx;
const ABI = allAbis(ctx);
const labels = {
  [addr.botA]: "Bot A",
  [addr.botB]: "Bot B",
  [addr.botC]: "Bot C",
  [addr.fastBot]: "Hızlı Bot",
  [addr.owner]: "Owner",
  [addr.elifKlasik]: "ElifKlasik",
  [addr.elifZarf]: "ElifZarf",
};
const label = (a) => labels[a] ?? a;

// Fees, nonces and the hash encoding are settled once at start-up; no per-transaction lookups.
const fees = { current: await currentFees(ctx) };
setInterval(async () => {
  fees.current = await currentFees(ctx).catch(() => fees.current);
}, 10_000);

const senders = {};
for (const role of ["owner", "fastBot", "botA", "botB", "botC"]) senders[role] = await createSender(ctx, role, fees);
await checkHashEncoding();
fs.mkdirSync(STATE_DIR, { recursive: true });

let price = await read(ctx, c.oracle, "price");
const positions = {};
let paused = false;
const jobs = []; // { at: block, run }
const sentAt = {}; // "classic" | "start" -> ms
const inflight = new Map(); // txHash -> { what, head, t }
const t0ByAuction = new Map(); // auction id -> ms, for the elapsed time in the log
let classicT0 = 0;
let auctionT0 = 0;

const feed = startFeed({
  wsUrl: WS_URL,
  publicClient: ctx.publicClient,
  addresses: [c.oracle.address, c.pool.address, c.kz.address],
  onHead,
  onLog,
});

log(`Botlar çalışıyor. Zincir ${ctx.chainId}, KapaliZarf ${c.kz.address}, pencereler ${ctx.deployment.commitBlocks}/${ctx.deployment.revealBlocks} blok`);
log(`ElifKlasik ${addr.elifKlasik} | ElifZarf ${addr.elifZarf} | ETH ${fmt(price)}`);

startDropServer({
  port: DROP_PORT,
  health: async () => ({ ok: true, chainId: ctx.chainId, head: feed.lastHead(), price: price.toString(), paused }),
  drop: async ({ price: p }) => {
    const next = p ? parseUnits(String(p), 18) : DROP_PRICE;
    const hash = await track(senders.owner, c.oracle, "setPrice", [next], `Owner: ETH → ${fmt(next)}`);
    return { ok: true, hash };
  },
  reset: async () => {
    if (paused) throw new Error("reset zaten çalışıyor");
    paused = true;
    try {
      const summary = await reset(ctx);
      for (const s of Object.values(senders)) await s.sync();
      price = await read(ctx, c.oracle, "price");
      await refreshPositions();
      return { ok: true, ...summary };
    } finally {
      paused = false;
    }
  },
});

await joinLeftoverAuction();
await refreshPositions();
setInterval(() => paused || refreshPositions().catch(() => {}), 2_000);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onHead(n) {
  for (const job of jobs.filter((j) => n >= j.at)) {
    jobs.splice(jobs.indexOf(job), 1);
    job.run(n);
  }
  checkInflight(n);
}

function onLog(raw) {
  let ev;
  try {
    ev = decodeEventLog({ abi: ABI, data: raw.data, topics: raw.topics });
  } catch {
    return;
  }
  const block = BigInt(raw.blockNumber);
  noteIncluded(raw.transactionHash, block);
  const a = ev.args;

  switch (ev.eventName) {
    case "PriceUpdated":
      if (a.price !== price) log(`ETH fiyatı ${fmt(price)} → ${fmt(a.price)} (blok ${block})`);
      price = a.price;
      if (!paused) react();
      break;
    case "ClassicLiquidated":
      log(`KLASİK: ${label(a.liquidator)} sabit indirimle aldı. Ödenen ${fmt(a.price)}, Elif'e dönen ${fmt(a.refund)}${since(classicT0)}  ${txLink(raw.transactionHash)}`);
      positions[a.borrower] = { collateral: 0n, debt: 0n, inAuction: false };
      break;
    case "AuctionStarted":
      positions[a.borrower] = { ...positions[a.borrower], inAuction: true };
      log(
        `Açık artırma ${a.id.slice(0, 10)} (${label(a.borrower)}): değer ${fmt(a.value)}, taban ${fmt(a.reservePrice)}, ` +
          `teklif ≤ blok ${a.commitEnd}, açıklama ≤ blok ${a.revealEnd}`,
      );
      if (!paused) joinAuction(a.id, { bidCap: a.value, reservePrice: a.reservePrice, commitEnd: a.commitEnd, revealEnd: a.revealEnd });
      break;
    case "BidCommitted":
      log(`${label(a.bidder)}: mühürlü teklif zincirde (blok ${block})`);
      break;
    case "BidRevealed":
      log(`${label(a.bidder)}: zarf açıldı, teklif ${fmt(a.amount)} (blok ${block})`);
      break;
    case "AuctionSettled":
      log(`KAPALI ZARF: kazanan ${label(a.winner)}, ödenen ikinci fiyat ${fmt(a.price)}, Elif'e dönen ${fmt(a.refund)}${since(t0ByAuction.get(a.id))}  ${txLink(raw.transactionHash)}`);
      break;
    case "NoBids":
      log("Geçerli teklif yok, Bot C taban fiyattan likide ediyor");
      if (!paused) track(senders.botC, c.kz, "fallbackLiquidate", [a.id], "Bot C: fallbackLiquidate");
      break;
    case "FallbackLiquidated":
      log(`YEDEK: ${label(a.liquidator)} taban fiyattan aldı ${fmt(a.price)}, Elif'e dönen ${fmt(a.refund)}  ${txLink(raw.transactionHash)}`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Liquidations
// ---------------------------------------------------------------------------

/// Same rule as LendingPool.isLiquidatable, evaluated locally so nothing waits on a read.
function liquidatable(borrower) {
  const p = positions[borrower];
  if (!p || p.debt === 0n || p.inAuction) return false;
  const value = (p.collateral * price) / ONE;
  return value * LIQ_THRESHOLD_BPS < p.debt * 10_000n;
}

function react() {
  const now = Date.now();
  // Both go out in the same tick: the race is decided by the chain, not by this loop.
  if (liquidatable(addr.elifKlasik) && now - (sentAt.classic ?? 0) > RESEND_AFTER_MS) {
    sentAt.classic = now;
    classicT0 = now;
    track(senders.fastBot, c.pool, "liquidateClassic", [addr.elifKlasik], "Hızlı Bot: liquidateClassic");
  }
  if (liquidatable(addr.elifZarf) && now - (sentAt.start ?? 0) > RESEND_AFTER_MS) {
    sentAt.start = now;
    auctionT0 = now;
    track(senders.botA, c.pool, "startAuction", [addr.elifZarf], "Bot A: startAuction");
  }
}

async function refreshPositions() {
  for (const borrower of [addr.elifKlasik, addr.elifZarf]) {
    const [collateral, debt, inAuction] = await read(ctx, c.pool, "positionOf", [borrower]);
    positions[borrower] = { collateral, debt, inAuction };
  }
  // Catches a price change that happened while the feed was reconnecting.
  if (!paused) react();
}

// ---------------------------------------------------------------------------
// Sealed-bid auction
// ---------------------------------------------------------------------------

/// Commits for every bot that has not bid yet, then schedules the reveals and the settle.
/// Roadmap decision 6: a transaction sent when the chain shows block N lands in N + 1 at the
/// earliest, so reveals go out on head == commitEnd and the settle on head == revealEnd.
async function joinAuction(id, auction, { restoring = false } = {}) {
  if (t0ByAuction.has(id)) return;
  t0ByAuction.set(id, auctionT0 || Date.now());
  auctionT0 = 0;
  const secrets = loadSecrets(id);

  for (const bot of BIDDERS) {
    if (secrets[bot.role]) continue;
    if (restoring && feed.lastHead() >= auction.commitEnd) continue;
    const amount = ((auction.bidCap * (10_000n - bot.marginBps)) / 10_000n / ONE) * ONE;
    if (amount < auction.reservePrice) {
      log(`${bot.label}: teklifi tabanın altında kalıyor, katılmıyor`);
      continue;
    }
    const salt = `0x${randomBytes(32).toString("hex")}`;
    secrets[bot.role] = { amount: amount.toString(), salt };
    saveSecrets(id, secrets); // before sending: a crash must never lose a committed salt
    track(senders[bot.role], c.kz, "commit", [id, hashBid(id, amount, salt, addr[bot.role])], `${bot.label}: commit`);
  }

  jobs.push({
    at: auction.commitEnd,
    run: () => {
      for (const bot of BIDDERS) {
        const s = secrets[bot.role];
        if (s) track(senders[bot.role], c.kz, "reveal", [id, BigInt(s.amount), s.salt], `${bot.label}: reveal ${fmt(BigInt(s.amount))}`);
      }
    },
  });
  jobs.push({ at: auction.revealEnd, run: () => track(senders.botC, c.kz, "settle", [id], "Bot C: settle") });
}

/// After a restart: joins ElifZarf's open auction, revealing with the salts saved on disk.
async function joinLeftoverAuction() {
  const id = await read(ctx, c.kz, "latestAuctionOf", [addr.elifZarf]);
  if (id === zeroHash) return;
  const auction = await read(ctx, c.kz, "getAuction", [id]);
  if (auction.status !== ACTIVE) return;
  log(`Açık kalmış açık artırma bulundu (${id.slice(0, 10)}), kaldığı yerden devam`);
  await joinAuction(id, auction, { restoring: true });
}

/// Same as KapaliZarf.hashBid: keccak256(abi.encode(id, amount, salt, bidder)).
function hashBid(id, amount, salt, bidder) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" }],
      [id, amount, salt, bidder],
    ),
  );
}

/// Refuses to start if the local encoding differs from the contract's: better here than on stage.
async function checkHashEncoding() {
  const id = keccak256("0x01");
  const salt = keccak256("0x02");
  const onChain = await read(ctx, c.kz, "hashBid", [id, 890n * ONE, salt, addr.botA]);
  if (onChain !== hashBid(id, 890n * ONE, salt, addr.botA)) fail("hashBid kontrattakiyle uyuşmuyor; botlar başlamadı.");
}

const secretsFile = (id) => path.join(STATE_DIR, `${id}.json`);
function loadSecrets(id) {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(id), "utf8"));
  } catch {
    return {};
  }
}
function saveSecrets(id, secrets) {
  fs.writeFileSync(secretsFile(id), JSON.stringify(secrets, null, 2));
}

// ---------------------------------------------------------------------------
// Sending and inclusion log
// ---------------------------------------------------------------------------

/// Sends without waiting and remembers the head it went out at. The matching event reports how many
/// blocks it took; that number decides how short the windows can be.
async function track(sender, contract, functionName, args, what) {
  const head = feed.lastHead();
  try {
    const hash = await sender.send(contract, functionName, args);
    inflight.set(hash, { what, head, t: Date.now() });
    log(`→ ${what} (head ${head})  ${hash}`);
    return hash;
  } catch (err) {
    log(`✗ ${what}:`, err.shortMessage ?? err.message);
    return null;
  }
}

function noteIncluded(hash, block) {
  const tx = inflight.get(hash);
  if (!tx) return;
  inflight.delete(hash);
  log(`  ✓ ${tx.what}: blok ${block}, +${block - tx.head} blok, ${Date.now() - tx.t} ms`);
}

/// A transaction with no event after a few blocks either reverted or is stuck; ask once.
function checkInflight(head) {
  for (const [hash, tx] of inflight) {
    if (head - tx.head < 6n) continue;
    inflight.delete(hash);
    ctx.publicClient
      .getTransactionReceipt({ hash })
      .then((r) => log(`  ✗ ${tx.what}: ${r.status === "success" ? "girdi ama event yok" : "revert"} (blok ${r.blockNumber})  ${txLink(hash)}`))
      .catch(() => log(`  ? ${tx.what}: ${head - tx.head} blokta zincirde görünmedi  ${txLink(hash)}`));
  }
}

function since(t0) {
  if (!t0) return "";
  return ` (${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} sn)`;
}
