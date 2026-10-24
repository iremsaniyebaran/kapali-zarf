import { useEffect, useRef, useState } from 'react'
import { createPublicClient, decodeEventLog, http, type Address, type Hash, type Log } from 'viem'
import { ABI, ADDRESSES, ORACLE_ABI, POOL_ABI, RPC_URL, WSS_URL } from '../config'
import type { ChainEvent, StageEvent } from '../stage'
import { createPlayer } from './player'
import type { Step } from './mock'

const FALLBACK_KIND: Record<string, string> = { monadLogs: 'logs', monadNewHeads: 'newHeads' }
/** On load, recent logs are replayed so a reload in the middle of the demo loses nothing. */
const RESTORE_BLOCKS = 300n
const LOG_RANGE = 100n
/** The frozen events the page plays; the contracts emit others (Borrowed, Deposited, …). */
const STAGE_EVENTS = new Set([
  'PriceUpdated',
  'ClassicLiquidated',
  'AuctionStarted',
  'BidCommitted',
  'BidRevealed',
  'AuctionSettled',
  'NoBids',
  'FallbackLiquidated',
])

type RawLog = Pick<Log, 'data' | 'topics'> & { blockNumber: bigint | string | null; transactionHash: Hash | null; logIndex: number | string | null }

export function toEvent(raw: RawLog): ChainEvent | undefined {
  try {
    const ev = decodeEventLog({ abi: ABI, data: raw.data, topics: raw.topics as [Hash, ...Hash[]] })
    if (!ev.eventName || !STAGE_EVENTS.has(ev.eventName)) return undefined
    return {
      type: ev.eventName,
      block: BigInt(raw.blockNumber ?? 0),
      tx: raw.transactionHash ?? undefined,
      ...(ev.args as object),
    } as unknown as ChainEvent
  } catch {
    return undefined
  }
}

/** Live mode: Monad's early monadLogs / monadNewHeads over the browser's own WebSocket (same logic
 * as bots/ws.mjs), plus the reads that rebuild the page after a reload. */
export function useChainFeed(dispatch: (e: StageEvent) => void, enabled: boolean) {
  const [connected, setConnected] = useState(false)
  const recording = useRef<{ t: number; ev: ChainEvent }[]>([])

  useEffect(() => {
    if (!enabled || !ADDRESSES) return
    const A = ADDRESSES
    const addresses = [ADDRESSES.oracle, ADDRESSES.pool, ADDRESSES.zarf]
    const client = createPublicClient({ transport: http(RPC_URL) })
    const player = createPlayer(dispatch)
    const seen = new Set<string>()
    let closed = false
    const sockets: WebSocket[] = []

    const onLog = (raw: RawLog, replay = false) => {
      const key = `${raw.transactionHash}:${Number(raw.logIndex)}`
      if (seen.has(key)) return
      seen.add(key)
      const ev = toEvent(raw)
      if (!ev) return
      if (!replay) recording.current.push({ t: Date.now(), ev })
      if (ev.type === 'PriceUpdated' && ev.price > lastPrice) refreshPositionsSoon()
      if (ev.type === 'PriceUpdated') lastPrice = ev.price
      player.push(ev)
    }

    // After a reset the price goes back up and the Elifs reopen their positions a few blocks later.
    let lastPrice = 0n
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refreshPositionsSoon = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => snapshot().catch(() => {}), 6_000)
    }

    const snapshot = async () => {
      const [price, klasik, zarf] = await Promise.all([
        client.readContract({ address: A.oracle, abi: ORACLE_ABI, functionName: 'price' }) as Promise<bigint>,
        readPosition(A.elifKlasik),
        readPosition(A.elifZarf),
      ])
      lastPrice = price
      dispatch({ type: 'Snapshot', price, klasik, zarf })
    }
    const readPosition = async (who: Address) => {
      const [collateral, debt] = (await client.readContract({
        address: A.pool,
        abi: POOL_ABI,
        functionName: 'positionOf',
        args: [who],
      })) as readonly [bigint, bigint, boolean, bigint, bigint]
      return { collateral, debt }
    }

    const subscribe = (kind: string, params: unknown[], onData: (r: Record<string, unknown>) => void) => {
      const ws = new WebSocket(WSS_URL)
      sockets.push(ws)
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: [kind, ...params] }))
      ws.onmessage = (msg) => {
        const data = JSON.parse(String(msg.data))
        if (data.id === 1) {
          if (data.error && FALLBACK_KIND[kind]) {
            ws.onclose = null
            ws.close()
            subscribe(FALLBACK_KIND[kind], params, onData)
          } else setConnected(!data.error)
          return
        }
        const r = data.params?.result
        if (r) onData(r)
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) setTimeout(() => subscribe(kind, params, onData), 500)
      }
    }

    ;(async () => {
      await snapshot().catch(() => {})
      const head = await client.getBlockNumber()
      dispatch({ type: 'Head', block: head })
      const from = head > RESTORE_BLOCKS ? head - RESTORE_BLOCKS : 0n
      const start = BigInt(ADDRESSES.deployBlock) > from ? BigInt(ADDRESSES.deployBlock) : from
      const past: RawLog[] = []
      for (let lo = start; lo <= head; lo += LOG_RANGE) {
        const hi = lo + LOG_RANGE - 1n < head ? lo + LOG_RANGE - 1n : head
        past.push(...(await client.getLogs({ address: addresses, fromBlock: lo, toBlock: hi }).catch(() => [])))
      }
      for (const raw of past) {
        const key = `${raw.transactionHash}:${Number(raw.logIndex)}`
        if (seen.has(key)) continue
        seen.add(key)
        const ev = toEvent(raw)
        if (ev) player.replay([ev])
      }
      if (closed) return
      subscribe('monadNewHeads', [], (h) => player.push({ type: 'Head', block: BigInt(h.number as string) }))
      subscribe('monadLogs', [{ address: addresses }], (r) => onLog(r as unknown as RawLog))
    })()

    return () => {
      closed = true
      player.stop()
      if (refreshTimer) clearTimeout(refreshTimer)
      sockets.forEach((ws) => {
        ws.onclose = null
        ws.close()
      })
    }
  }, [dispatch, enabled])

  /** The live events so far as a mock script (roadmap: generate ?mock=1 from a real rehearsal). */
  const exportScript = (): Step[] => {
    const evs = recording.current
    // From the last price drop on: one full round.
    let startAt = 0
    evs.forEach((r, i) => {
      const prev = evs.slice(0, i).reverse().find((x) => x.ev.type === 'PriceUpdated')
      if (r.ev.type === 'PriceUpdated' && prev?.ev.type === 'PriceUpdated' && r.ev.price < prev.ev.price) startAt = i
    })
    const slice = evs.slice(startAt)
    return slice.map((r, i) => ({ after: i === 0 ? 0 : r.t - slice[i - 1].t, ev: r.ev }))
  }

  return { connected, exportScript }
}
