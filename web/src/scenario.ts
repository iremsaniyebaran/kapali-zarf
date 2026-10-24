import type { Address } from 'viem'
import { DEMO, GUEST } from './config'

/** What the presenter controls: how far ETH falls, how the bots bid, and their own sealed bid. */
export interface Strategy {
  role: 'botA' | 'botB' | 'botC'
  label: string
  marginBps: number
  enabled: boolean
}

export interface Scenario {
  dropPct: number
  bidders: Strategy[]
  /** Whole mUSD, armed for the next auction; null when the presenter is not bidding. */
  guest: number | null
}

export const START_PRICE = 1000
/** 5% would not make the position liquidatable (threshold ≈ 941 $); 20% shows bad debt. */
export const DROP_OPTIONS = [7, 10, 15, 20] as const
export const MAX_MARGIN_BPS = 1_000

export const DEFAULT_BIDDERS: Strategy[] = [
  { role: 'botA', label: 'Bot A', marginBps: 111, enabled: true },
  { role: 'botB', label: 'Bot B', marginBps: 166, enabled: true },
  { role: 'botC', label: 'Bot C', marginBps: 333, enabled: true },
]

export const DEFAULT_SCENARIO: Scenario = { dropPct: 10, bidders: DEFAULT_BIDDERS, guest: null }

export const dropPriceOf = (pct: number) => Math.round(START_PRICE * (1 - pct / 100))

/** Same rounding as bots/bots.mjs: value minus the margin, down to a whole mUSD. */
export const bidOf = (value: number, marginBps: number) => Math.floor((value * (10_000 - marginBps)) / 10_000)

export const reserveOf = (value: number) => Math.floor((value * 9_000) / 10_000)

/** The demo position: 1 ETH collateral, 800 debt, liquidatable below 85% loan-to-value. */
export const DEBT = 800

export const healthAt = (price: number) => (price * 0.85) / DEBT
export const liquidatableAt = (price: number) => price * 8_500 < DEBT * 10_000

export function addressOf(role: Strategy['role'] | 'guest'): Address {
  if (role === 'botA') return DEMO.bots.a
  if (role === 'botB') return DEMO.bots.b
  if (role === 'botC') return DEMO.bots.c
  return GUEST
}

export const sameScenario = (a: Scenario, b: Scenario) => JSON.stringify(a) === JSON.stringify(b)
