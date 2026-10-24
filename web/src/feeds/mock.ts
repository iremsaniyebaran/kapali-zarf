import { useEffect, useMemo, useRef } from 'react'
import type { Hash } from 'viem'
import { BLOCK_SECONDS, DEMO } from '../config'
import { DEMO_POSITION, ONE, type ChainEvent, type StageEvent } from '../stage'
import { createPlayer } from './player'

/** One step of a script: wait `after` ms since the previous step, then play `ev`. */
export interface Step {
  after: number
  ev: ChainEvent
}

const BLOCK_MS = BLOCK_SECONDS * 1000
const BASE = 1_000n
const ID = '0x215be5d2c8a54d1f3b6a3f4f0f1c2b9a8e7d6c5b4a39281706f5e4d3c2b1a090' as Hash
const usd = (n: number) => BigInt(n) * ONE

/** The document's numbers: ETH 1000 → 900, bids 890 / 885 / 870, 8 + 8 block windows. */
function defaultScript(): Step[] {
  const commitEnd = BASE + 1n + BigInt(DEMO.commitBlocks)
  const revealEnd = commitEnd + BigInt(DEMO.revealBlocks)
  const { a, b, c, fast } = DEMO.bots
  const at: [bigint, ChainEvent][] = [
    [BASE, { type: 'PriceUpdated', block: BASE, price: usd(900) }],
    [BASE + 1n, { type: 'ClassicLiquidated', block: BASE + 1n, borrower: DEMO.elifKlasik, liquidator: fast, price: usd(810), debtRepaid: usd(800), refund: usd(10) }],
    [BASE + 1n, { type: 'AuctionStarted', block: BASE + 1n, id: ID, borrower: DEMO.elifZarf, collateral: ONE, debt: usd(800), value: usd(900), reservePrice: usd(810), commitEnd, revealEnd }],
    [BASE + 2n, { type: 'BidCommitted', block: BASE + 2n, id: ID, bidder: b }],
    [BASE + 2n, { type: 'BidCommitted', block: BASE + 2n, id: ID, bidder: a }],
    [BASE + 2n, { type: 'BidCommitted', block: BASE + 2n, id: ID, bidder: c }],
    [commitEnd + 1n, { type: 'BidRevealed', block: commitEnd + 1n, id: ID, bidder: a, amount: usd(890) }],
    [commitEnd + 1n, { type: 'BidRevealed', block: commitEnd + 1n, id: ID, bidder: b, amount: usd(885) }],
    [commitEnd + 1n, { type: 'BidRevealed', block: commitEnd + 1n, id: ID, bidder: c, amount: usd(870) }],
    [revealEnd + 1n, { type: 'AuctionSettled', block: revealEnd + 1n, id: ID, winner: a, price: usd(885), debtRepaid: usd(800), refund: usd(85) }],
  ]
  let prev = 0
  return at.map(([block, ev]) => {
    const t = Number(block - BASE) * BLOCK_MS
    const step = { after: t - prev, ev }
    prev = t
    return step
  })
}

// A script recorded from a real rehearsal (press K on the live page) replaces the default one.
const recorded = import.meta.glob<Step[]>('./recorded.json', { eager: true, import: 'default' })['./recorded.json']

export function mockScript(): Step[] {
  if (!recorded) return defaultScript()
  return recorded.map((s) => ({ after: s.after, ev: reviveBigInts(s.ev) as ChainEvent }))
}

/** Plays the script when the stage button is pressed; heads tick every block meanwhile. */
export function useMockFeed(dispatch: (e: StageEvent) => void, enabled: boolean) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const player = useMemo(() => createPlayer(dispatch), [dispatch])

  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const reset = () => {
    clear()
    dispatch({ type: 'Reset', price: usd(1000) })
    dispatch({ type: 'Snapshot', price: usd(1000), klasik: DEMO_POSITION, zarf: DEMO_POSITION })
  }

  const trigger = () => {
    reset()
    const script = mockScript()
    const first = script[0]?.ev.block ?? BASE
    const last = script.reduce((b, s) => (s.ev.block > b ? s.ev.block : b), first)
    let t = 0
    for (const step of script) {
      t += step.after
      timers.current.push(setTimeout(() => player.push(step.ev), t))
    }
    for (let block = first; block <= last + 1n; block++) {
      const at = Number(block - first) * BLOCK_MS
      timers.current.push(setTimeout(() => player.push({ type: 'Head', block }), at))
    }
  }

  useEffect(() => {
    if (!enabled) return
    reset()
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return { trigger, reset }
}

/** Recorded scripts store bigints as "123n" strings. */
export function reviveBigInts(value: unknown): unknown {
  if (typeof value === 'string' && /^\d+n$/.test(value)) return BigInt(value.slice(0, -1))
  if (Array.isArray(value)) return value.map(reviveBigInts)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveBigInts(v)]))
  return value
}

export function stringifyScript(steps: Step[]): string {
  return JSON.stringify(steps, (_, v) => (typeof v === 'bigint' ? `${v}n` : v), 2)
}
