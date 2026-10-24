// Early events. Monad's monadLogs / monadNewHeads subscriptions deliver a block's data about a second
// before the standard logs / newHeads ones (speculatively, before the block is voted). Chains that
// do not know them (Anvil) get the standard subscriptions instead. While the socket is down, a
// single HTTP poller (eth_blockNumber + a narrow eth_getLogs) keeps the bots going within the
// public RPC's ~25 requests per second.
import { log, sleep } from "./config.mjs";

const FALLBACK_KIND = { monadLogs: "logs", monadNewHeads: "newHeads" };

/// Raw eth_subscribe with reconnect. The same record can arrive again at a later commit stage;
/// `key` deduplicates it. Returns { isOpen } so a caller can tell when to fall back to polling.
export function subscribe(url, kind, filter, onData, key) {
  const state = { open: false, kind };
  const seen = new Set();

  const connect = () => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: filter ? [state.kind, filter] : [state.kind] }));
    });
    ws.addEventListener("message", (msg) => {
      const data = JSON.parse(msg.data.toString());
      if (data.id === 1) {
        if (data.error && FALLBACK_KIND[state.kind]) {
          log(`ws: ${state.kind} desteklenmiyor, ${FALLBACK_KIND[state.kind]} kullanılıyor`);
          state.kind = FALLBACK_KIND[state.kind];
          ws.close();
          return;
        }
        state.open = !data.error;
        return;
      }
      const r = data.params?.result;
      if (!r) return;
      const k = key(r);
      if (seen.has(k)) return;
      seen.add(k);
      if (seen.size > 5000) seen.delete(seen.values().next().value);
      onData(r);
    });
    ws.addEventListener("close", () => {
      state.open = false;
      setTimeout(connect, 500);
    });
    ws.addEventListener("error", () => {});
  };
  connect();
  return { isOpen: () => state.open };
}

/// Heads and logs for `addresses`, from the socket when it is up and from polling when it is not.
/// onHead(number: bigint), onLog(rawLog). Both are deduplicated across the two sources.
export function startFeed({ wsUrl, publicClient, addresses, fromBlock, onHead, onLog }) {
  const seenLogs = new Set();
  let lastHead = 0n;

  const head = (n) => {
    if (n <= lastHead) return;
    lastHead = n;
    onHead(n);
  };
  const logKey = (l) => `${l.transactionHash}:${Number(l.logIndex)}`;
  const emitLog = (l) => {
    const k = logKey(l);
    if (seenLogs.has(k)) return;
    seenLogs.add(k);
    if (seenLogs.size > 5000) seenLogs.delete(seenLogs.values().next().value);
    // A log from block N means N exists, even if its head notification is still on the way.
    if (l.blockNumber != null) head(BigInt(l.blockNumber));
    onLog(l);
  };

  const heads = wsUrl ? subscribe(wsUrl, "monadNewHeads", null, (h) => head(BigInt(h.number)), (h) => String(h.number)) : null;
  const logs = wsUrl ? subscribe(wsUrl, "monadLogs", { address: addresses }, emitLog, logKey) : null;

  // Poller: always runs, but only does work while a subscription is down.
  let polledTo = fromBlock;
  (async () => {
    for (;;) {
      try {
        const live = heads?.isOpen() && logs?.isOpen();
        if (!live) {
          const n = await publicClient.getBlockNumber();
          if (polledTo === undefined || n - polledTo > 50n) polledTo = n - 1n;
          if (n > polledTo) {
            const found = await publicClient.getLogs({ address: addresses, fromBlock: polledTo + 1n, toBlock: n });
            for (const l of found) emitLog(l);
            polledTo = n;
          }
          head(n);
        } else {
          polledTo = lastHead;
        }
      } catch (err) {
        log("poll:", err.shortMessage ?? err.message);
      }
      await sleep(200);
    }
  })();

  return { lastHead: () => lastHead };
}
