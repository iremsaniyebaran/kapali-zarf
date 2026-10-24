import { useEffect, useRef } from 'react'
import type { Address, Hash } from 'viem'
import { BLOCK_SECONDS, DEMO } from '../config'
import { DEMO_POSITION, ONE, type ChainEvent, type StageEvent } from '../stage'
import { addressOf, bidOf, DEBT, DEFAULT_SCENARIO, dropPriceOf, liquidatableAt, reserveOf, sameScenario, START_PRICE, type Scenario } from '../scenario'
import { playScript, type Step } from './player'

export type { Step }

const BLOCK_MS = BLOCK_SECONDS * 1000
const BASE = 1_000n
const usd = (n: number) => BigInt(n) * ONE

/** The round the contracts would produce for `scenario`: same pricing, same tie rule (first reveal
 * wins), same split of the price between the debt and Elif. Used by ?mock=1. */
export function buildScript(scenario: Scenario, auctionNonce = 0): Step[] {
  const value = dropPriceOf(scenario.dropPct)
  const reserve = reserveOf(value)
  const commitEnd = BASE + 1n + BigInt(DEMO.commitBlocks)
  const revealEnd = commitEnd + BigInt(DEMO.revealBlocks)
  const id = `0x${(0x215be5d2 + auctionNonce).toString(16).padStart(8, '0')}${'0'.repeat(56)}` as Hash
  const split = (price: number) => ({ repaid: Math.min(price, DEBT), refund: Math.max(0, price - DEBT) })

  const at: [bigint, ChainEvent][] = [[BASE, { type: 'PriceUpdated', block: BASE, price: usd(value) }]]
  if (!liquidatableAt(value)) return toSteps(at)

  const classic = split(reserve)
  at.push([BASE + 1n, { type: 'ClassicLiquidated', block: BASE + 1n, borrower: DEMO.elifKlasik, liquidator: DEMO.bots.fast, price: usd(reserve), debtRepaid: usd(classic.repaid), refund: usd(classic.refund) }])
  at.push([BASE + 1n, { type: 'AuctionStarted', block: BASE + 1n, id, borrower: DEMO.elifZarf, collateral: ONE, debt: usd(DEBT), value: usd(value), reservePrice: usd(reserve), commitEnd, revealEnd }])

  const bids: { bidder: Address; amount: number }[] = scenario.bidders
    .filter((b) => b.enabled)
    .map((b) => ({ bidder: addressOf(b.role), amount: bidOf(value, b.marginBps) }))
    .filter((b) => b.amount >= reserve)
  if (scenario.guest !== null && scenario.guest >= reserve && scenario.guest <= value) bids.push({ bidder: addressOf('guest'), amount: scenario.guest })

  for (const b of bids) at.push([BASE + 2n, { type: 'BidCommitted', block: BASE + 2n, id, bidder: b.bidder }])
  for (const b of bids) at.push([commitEnd + 1n, { type: 'BidRevealed', block: commitEnd + 1n, id, bidder: b.bidder, amount: usd(b.amount) }])

  const settle = revealEnd + 1n
  if (bids.length === 0) {
    at.push([settle, { type: 'NoBids', block: settle, id }])
    const fb = split(reserve)
    at.push([settle + 1n, { type: 'FallbackLiquidated', block: settle + 1n, id, liquidator: DEMO.bots.c, price: usd(reserve), refund: usd(fb.refund) }])
    return toSteps(at)
  }
  // Highest wins; on a tie the earlier reveal keeps the lead. The winner pays the second price.
  let best = bids[0]
  let second = 0
  for (const b of bids.slice(1)) {
    if (b.amount > best.amount) {
      second = best.amount
      best = b
    } else if (b.amount > second) second = b.amount
  }
  const price = Math.max(second, reserve)
  const result = split(price)
  at.push([settle, { type: 'AuctionSettled', block: settle, id, winner: best.bidder, price: usd(price), debtRepaid: usd(result.repaid), refund: usd(result.refund) }])
  return toSteps(at)
}

function toSteps(at: [bigint, ChainEvent][]): Step[] {
  let prev = 0
  return at.map(([block, ev]) => {
    const t = Number(block - BASE) * BLOCK_MS
    const step = { after: t - prev, ev }
    prev = t
    return step
  })
}

// A script recorded from a real rehearsal (press K on the live page) replaces the default round.
const recorded = import.meta.glob<Step[]>('./recorded.json', { eager: true, import: 'default' })['./recorded.json']

export function mockScript(scenario: Scenario, nonce = 0): Step[] {
  if (recorded && sameScenario(scenario, DEFAULT_SCENARIO)) {
    return recorded.map((s) => ({ after: s.after, ev: reviveBigInts(s.ev) as ChainEvent }))
  }
  return buildScript(scenario, nonce)
}

/** Plays the scenario when the stage button is pressed; heads tick every block meanwhile. */
export function useMockFeed(dispatch: (e: StageEvent) => void, enabled: boolean) {
  const stop = useRef<() => void>(() => {})
  const rounds = useRef(0)

  const reset = () => {
    stop.current()
    dispatch({ type: 'Reset', price: usd(START_PRICE) })
    dispatch({ type: 'Snapshot', price: usd(START_PRICE), klasik: DEMO_POSITION, zarf: DEMO_POSITION })
  }

  /** Returns the script it plays, so the round can be kept for the history and replayed. */
  const trigger = (scenario: Scenario): Step[] => {
    reset()
    const script = mockScript(scenario, rounds.current++)
    stop.current = playScript(script, dispatch, { blockMs: BLOCK_MS })
    return script
  }

  useEffect(() => {
    if (!enabled) return
    reset()
    return () => stop.current()
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
